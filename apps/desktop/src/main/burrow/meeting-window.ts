// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Electron side of the private notetaker. A hidden window in its own session records the
// microphone and the computer's sound (Windows: WASAPI loopback; Mac: ScreenCaptureKit / Core
// Audio, behind Chromium's loopback features), so no other page ever gets either permission.
// The person says yes before every call; the OS asks once more the first time.
import { execFile } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, desktopCapturer, dialog, Notification, session } from "electron";
import type { CallApp } from "./meeting-notetaker.js";
import { MeetingNotetaker } from "./meeting-notetaker.js";
import type { TranscriptLine } from "./meeting-transcriber.js";
import { transcribeMeeting, transcriptText } from "./meeting-transcriber.js";

const PARTITION = "gente-meeting-capture";
const CHECK_EVERY_MS = 15_000;

/** Must run before the app is ready: lets Chromium capture system audio on a Mac. */
export function enableMeetingAudioCapture() {
  if (process.platform === "darwin") {
    app.commandLine.appendSwitch(
      "enable-features",
      "MacLoopbackAudioForScreenShare,MacCatapLoopbackAudioForScreenShare",
    );
  }
}

function listProcesses(): Promise<string[]> {
  const [file, args] =
    process.platform === "win32"
      ? ["tasklist", ["/fo", "csv", "/nh"]]
      : ["/bin/ps", ["-axco", "comm="]];
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve([]);
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) =>
            process.platform === "win32" ? (line.split('","')[0] ?? "").replace(/^"/, "") : line,
          )
          .filter(Boolean),
      );
    });
  });
}

async function askConsent(app_: CallApp | "call"): Promise<boolean> {
  const where = app_ === "call" ? "this call" : `your ${app_} call`;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Take notes", "Not now"],
    defaultId: 0,
    cancelId: 1,
    message: `Take private notes of ${where}?`,
    detail:
      "Your AI records your microphone and the call's sound on this computer, writes notes and drafts follow-ups. The audio never leaves this computer. Let the others in the call know you're taking notes.",
  });
  return response === 0;
}

function recordInHiddenWindow(): { stop: () => Promise<ArrayBuffer | null> } {
  const captureSession = session.fromPartition(PARTITION);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: captureSession,
      preload: path.join(import.meta.dirname, "meeting-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const ours = (contents: Electron.WebContents) =>
    !window.isDestroyed() && contents === window.webContents;
  // Replaces the app's policy for this partition only: media, for this window, nothing else.
  const allowed = (permission: string) =>
    permission === "media" || permission === "display-capture";
  captureSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(allowed(permission) && ours(contents)),
  );
  captureSession.setPermissionCheckHandler(
    (contents, permission) => allowed(permission) && contents !== null && ours(contents),
  );
  captureSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Only this window uses the partition.
    if (window.isDestroyed()) return callback({});
    const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
    // The screen is required to ask for sound; the page drops its picture at once.
    callback(screen ? { video: screen, audio: "loopback" } : {});
  });
  let resolveFinished: (pcm: ArrayBuffer | null) => void = () => {};
  const finished = new Promise<ArrayBuffer | null>((resolve) => {
    resolveFinished = resolve;
  });
  const onFinished = (event: Electron.IpcMainEvent, pcm: unknown) => {
    if (!ours(event.sender)) return;
    resolveFinished(pcm instanceof ArrayBuffer ? pcm : null);
  };
  const onStarted = (event: Electron.IpcMainEvent, sources: { mic?: boolean; call?: boolean }) => {
    if (!ours(event.sender)) return;
    if (!sources?.mic && !sources?.call) resolveFinished(null);
  };
  // This window's own channel: no other page can send on it.
  window.webContents.ipc.on("gente.meeting.finished", onFinished);
  window.webContents.ipc.on("gente.meeting.started", onStarted);
  void window.loadFile(path.join(import.meta.dirname, "meeting.html"));
  return {
    stop: async () => {
      if (!window.isDestroyed()) window.webContents.send("gente.meeting.stop");
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000));
      const pcm = await Promise.race([finished, timeout]);
      if (!window.isDestroyed()) window.destroy();
      return pcm;
    },
  };
}

let notetaker: MeetingNotetaker | null = null;

/** The running notetaker, for the app menu. */
export const meetingNotetaker = () => notetaker;

/**
 * Starts watching for calls. `deliver` gets each finished transcript, as the text the Meeting
 * notes recipe reads (one line per segment, `You:` and `Them:` when it can tell).
 */
export function startMeetingNotetaker(
  deliver: (text: string, lines: TranscriptLine[]) => void,
  onChange?: () => void,
) {
  if (notetaker) return notetaker;
  const userData = app.getPath("userData");
  notetaker = new MeetingNotetaker({
    listProcesses,
    askConsent,
    record: recordInHiddenWindow,
    transcribe: async (wavPath) => {
      const lines = await transcribeMeeting(wavPath, {
        modelDir: path.join(userData, "whisper"),
        stereo: true,
      }).catch(() => null);
      // The recording is kept, so notes can still be written once transcription is set up.
      if (!lines)
        new Notification({
          title: "Meeting notes",
          body: "Your call is saved on this computer. Your AI will write the notes once speech-to-text finishes setting up.",
        }).show();
      return lines;
    },
    deliver: ({ lines }) => {
      new Notification({
        title: "Meeting notes",
        body: "Your call is transcribed. Your AI is writing the notes.",
      }).show();
      deliver(transcriptText(lines), lines);
    },
    meetingsDir: path.join(userData, "meetings"),
    onChange,
  });
  const timer = setInterval(() => void notetaker?.check(), CHECK_EVERY_MS);
  timer.unref();
  return notetaker;
}

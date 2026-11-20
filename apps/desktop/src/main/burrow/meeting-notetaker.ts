// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The private notetaker's logic, free of Electron so it can be tested: notice a call, ask the
// person once, record it, and when the call ends turn the recording into a transcript on this
// computer. Nothing here sends audio anywhere.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptLine } from "./meeting-transcriber.js";

export type CallApp = "Zoom" | "Webex";

/**
 * Processes that exist only while a call is on, by the call app they belong to. Zoom starts
 * CptHost/aomhost for a meeting; Webex starts its meeting process. Teams and browser calls (Meet)
 * have no such process, so the person starts notes from the menu for those.
 */
const CALL_PROCESSES: Record<CallApp, readonly string[]> = {
  Zoom: ["cpthost", "aomhost"],
  Webex: ["webexmta", "atmgr", "cisco webex meeting center"],
};

export function detectCall(processNames: readonly string[]): CallApp | null {
  const running = new Set(
    processNames.map((name) =>
      path
        .basename(name.trim())
        .toLowerCase()
        .replace(/\.exe$/, ""),
    ),
  );
  for (const [app, names] of Object.entries(CALL_PROCESSES) as Array<
    [CallApp, readonly string[]]
  >) {
    if (names.some((name) => running.has(name))) return app;
  }
  return null;
}

/** A 16 kHz, 16-bit stereo WAV around interleaved samples (microphone left, call right). */
export function wavFromPcm(pcm: ArrayBuffer, sampleRate = 16_000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

export type NotetakerDeps = {
  listProcesses: () => Promise<string[]>;
  /** Asks the person whether to take notes; resolves true only on a clear yes. */
  askConsent: (app: CallApp | "call") => Promise<boolean>;
  /** Starts recording; resolves with the samples once `stop` is called. */
  record: () => { stop: () => Promise<ArrayBuffer | null> };
  transcribe: (wavPath: string) => Promise<TranscriptLine[] | null>;
  /** Hands the finished transcript on (to the assistant's Meeting notes recipe). */
  deliver: (result: { app: CallApp | "call"; wavPath: string; lines: TranscriptLine[] }) => void;
  meetingsDir: string;
  now?: () => Date;
  /** Recording started or stopped (the app menu shows which). */
  onChange?: () => void;
};

/**
 * Started by a detected call (after the person says yes) or from the menu, and stopped by the
 * call ending or the menu. A call the person declined is not asked about again until it ends.
 */
export class MeetingNotetaker {
  private recording: { app: CallApp | "call"; stop: () => Promise<ArrayBuffer | null> } | null =
    null;
  private declined: CallApp | null = null;
  private asking = false;

  constructor(private readonly deps: NotetakerDeps) {}

  isRecording() {
    return this.recording !== null;
  }

  /** One look at the running processes; the caller repeats it every few seconds. */
  async check(): Promise<void> {
    const call = detectCall(await this.deps.listProcesses().catch(() => []));
    if (!call) {
      this.declined = null;
      if (this.recording && this.recording.app !== "call") await this.finish();
      return;
    }
    if (this.recording || this.asking || this.declined === call) return;
    this.asking = true;
    try {
      if (await this.deps.askConsent(call)) this.start(call);
      else this.declined = call;
    } finally {
      this.asking = false;
    }
  }

  /** From the menu: for calls Gente cannot see (Teams, Meet in a browser). */
  async startByHand(): Promise<boolean> {
    if (this.recording) return false;
    if (!(await this.deps.askConsent("call"))) return false;
    this.start("call");
    return true;
  }

  private start(app: CallApp | "call") {
    this.recording = { app, ...this.deps.record() };
    this.deps.onChange?.();
  }

  /** Stops recording and transcribes. Resolves to the saved recording, or null for nothing heard. */
  async finish(): Promise<string | null> {
    const current = this.recording;
    if (!current) return null;
    this.recording = null;
    this.deps.onChange?.();
    const pcm = await current.stop();
    if (!pcm || pcm.byteLength === 0) return null;
    const stamp = (this.deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
    await mkdir(this.deps.meetingsDir, { recursive: true });
    const wavPath = path.join(this.deps.meetingsDir, `${stamp}.wav`);
    await writeFile(wavPath, wavFromPcm(pcm));
    const lines = await this.deps.transcribe(wavPath);
    if (lines && lines.length > 0) this.deps.deliver({ app: current.app, wavPath, lines });
    return wavPath;
  }
}

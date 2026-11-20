// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The private notetaker's ears: a recorded call is transcribed on this computer with whisper.cpp,
// so the audio never leaves it. The transcript then goes to the person's assistant, whose
// "Meeting notes" recipe writes the notes and drafts the follow-ups under the usual approvals.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

/** Where whisper.cpp's command line tool is found, first match wins. */
export const WHISPER_BINARIES = [
  "/opt/homebrew/bin/whisper-cli",
  "/usr/local/bin/whisper-cli",
  "C:\\Program Files\\whisper.cpp\\whisper-cli.exe",
];

/** The small English model: about 140 MB, roughly 20 times faster than real time on Apple silicon. */
export const WHISPER_MODEL_FILE = "ggml-base.en.bin";

type Exec = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: Exec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }),
    );
  });

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

export async function findFirst(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return undefined;
}

/** `you` spoke into this computer's microphone; `others` came through its speakers. */
export type Speaker = "you" | "others";
export type TranscriptLine = { start: string; end: string; text: string; speaker?: Speaker };

/** whisper.cpp prints `[00:00:01.000 --> 00:00:04.000]   words` per segment. */
export function parseWhisperOutput(stdout: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const match = /^\[(\d\d:\d\d:\d\d)\.\d+ --> (\d\d:\d\d:\d\d)\.\d+\]\s*(.*)$/.exec(raw.trim());
    // With stereo input, whisper names the louder channel: 0 is the microphone, 1 the speakers.
    const voice = /^\(speaker ([01?])\)\s*/.exec(match?.[3] ?? "");
    const text = (voice ? match?.[3]?.slice(voice[0].length) : match?.[3])?.trim();
    // whisper marks silence and noise with bracketed tags; they are not speech.
    if (!match || !text || /^\[[^\]]*\]$|^\([^)]*\)$/.test(text)) continue;
    const speaker: Speaker | undefined =
      voice?.[1] === "0" ? "you" : voice?.[1] === "1" ? "others" : undefined;
    lines.push({ start: match[1]!, end: match[2]!, text, ...(speaker ? { speaker } : {}) });
  }
  return lines;
}

/** The transcript as the assistant reads it: one timestamped line per segment. */
export function transcriptText(lines: readonly TranscriptLine[]): string {
  const label = { you: "You: ", others: "Them: " };
  return lines
    .map((line) => `[${line.start}] ${line.speaker ? label[line.speaker] : ""}${line.text}`)
    .join("\n");
}

/**
 * Transcribes a 16 kHz WAV on this computer. A stereo recording (microphone left, the call's
 * sound right) comes back with who spoke: the person or the others in the call. Resolves to the lines, or null when the tool or
 * model is missing, so the caller can offer setup instead of showing an error.
 */
export async function transcribeMeeting(
  wavPath: string,
  options: {
    modelDir: string;
    binaries?: readonly string[];
    exec?: Exec;
    stereo?: boolean;
    /** An hour of audio takes about three minutes; allow for slower computers. */
    timeoutMs?: number;
  },
): Promise<TranscriptLine[] | null> {
  const binary = await findFirst(options.binaries ?? WHISPER_BINARIES);
  const model = path.join(options.modelDir, WHISPER_MODEL_FILE);
  if (!binary || !(await exists(model))) return null;
  const { stdout } = await (options.exec ?? defaultExec)(
    binary,
    ["-m", model, "-f", wavPath, "-np", "-l", "auto", ...(options.stereo ? ["-di"] : [])],
    { timeout: options.timeoutMs ?? 30 * 60_000 },
  );
  return parseWhisperOutput(stdout);
}

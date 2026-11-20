import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseWhisperOutput,
  transcribeMeeting,
  transcriptText,
  WHISPER_MODEL_FILE,
} from "./meeting-transcriber.js";

const OUTPUT = [
  "",
  "[00:00:00.000 --> 00:00:04.200]   Hi Daniel. Thanks for joining.",
  "[00:00:04.200 --> 00:00:06.000]   [BLANK_AUDIO]",
  "[00:00:06.000 --> 00:00:09.500]   Can you send us a quote by Friday?",
  "[00:00:09.500 --> 00:00:10.000]   (music)",
].join("\n");

describe("local meeting transcriber", () => {
  it("labels who spoke from a stereo recording: microphone is you, speakers are the others", () => {
    const lines = parseWhisperOutput(
      [
        "[00:00:00.000 --> 00:00:05.920]  (speaker 0) I will send the quote by Friday.",
        "[00:00:05.920 --> 00:00:09.000]  (speaker 1) Great, thanks.",
        "[00:00:09.000 --> 00:00:10.000]  (speaker ?) Both at once.",
      ].join("\n"),
    );
    expect(lines.map((line) => line.speaker)).toEqual(["you", "others", undefined]);
    expect(transcriptText(lines)).toBe(
      "[00:00:00] You: I will send the quote by Friday.\n[00:00:05] Them: Great, thanks.\n[00:00:09] Both at once.",
    );
  });

  it("keeps speech segments with their start times and drops silence tags", () => {
    const lines = parseWhisperOutput(OUTPUT);
    expect(lines).toEqual([
      { start: "00:00:00", end: "00:00:04", text: "Hi Daniel. Thanks for joining." },
      { start: "00:00:06", end: "00:00:09", text: "Can you send us a quote by Friday?" },
    ]);
    expect(transcriptText(lines)).toBe(
      "[00:00:00] Hi Daniel. Thanks for joining.\n[00:00:06] Can you send us a quote by Friday?",
    );
  });

  it("runs the local tool with the model on this computer, and returns null when either is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gente-whisper-"));
    const binary = path.join(dir, "whisper-cli");
    await writeFile(binary, "");
    const calls: string[][] = [];
    const exec = async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return { stdout: OUTPUT, stderr: "" };
    };
    expect(
      await transcribeMeeting("call.wav", { modelDir: dir, binaries: [binary], exec }),
    ).toBeNull();
    await writeFile(path.join(dir, WHISPER_MODEL_FILE), "");
    expect(
      await transcribeMeeting("call.wav", {
        modelDir: dir,
        binaries: [path.join(dir, "nope")],
        exec,
      }),
    ).toBeNull();
    const lines = await transcribeMeeting("call.wav", { modelDir: dir, binaries: [binary], exec });
    expect(lines).toHaveLength(2);
    expect(calls).toEqual([
      [binary, "-m", path.join(dir, WHISPER_MODEL_FILE), "-f", "call.wav", "-np", "-l", "auto"],
    ]);
  });
});

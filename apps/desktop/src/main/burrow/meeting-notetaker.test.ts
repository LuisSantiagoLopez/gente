import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NotetakerDeps } from "./meeting-notetaker.js";
import { detectCall, MeetingNotetaker, wavFromPcm } from "./meeting-notetaker.js";

describe("call detection", () => {
  it("sees a Zoom or Webex meeting by its meeting-only process, on Mac and Windows", () => {
    expect(
      detectCall([
        "/Applications/zoom.us.app/Contents/Frameworks/CptHost.app/Contents/MacOS/CptHost",
      ]),
    ).toBe("Zoom");
    expect(detectCall(["aomhost"])).toBe("Zoom");
    expect(detectCall(["CptHost.exe", "explorer.exe"])).toBe("Zoom");
    expect(detectCall(["atmgr.exe"])).toBe("Webex");
    // Zoom open but not in a meeting, or other apps: no call.
    expect(detectCall(["zoom.us", "Google Chrome", "MSTeams"])).toBeNull();
  });
});

describe("wav", () => {
  it("wraps stereo 16 kHz samples in a valid header", () => {
    const pcm = new Int16Array([1, -1, 2, -2]).buffer;
    const wav = wavFromPcm(pcm);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.length).toBe(52);
  });
});

function harness(overrides: Partial<NotetakerDeps> = {}) {
  let processes: string[] = [];
  const asked: string[] = [];
  const delivered: string[] = [];
  let recordings = 0;
  let changes = 0;
  const deps: NotetakerDeps = {
    listProcesses: async () => processes,
    askConsent: async (app) => {
      asked.push(app);
      return true;
    },
    record: () => {
      recordings++;
      return { stop: async () => new Int16Array([5, 6, 7, 8]).buffer };
    },
    transcribe: async () => [
      { start: "00:00:00", end: "00:00:02", text: "Quote by Friday.", speaker: "you" },
    ],
    deliver: ({ lines }) => delivered.push(lines.map((line) => line.text).join(" ")),
    meetingsDir: "",
    now: () => new Date("2026-11-20T10:00:00Z"),
    onChange: () => changes++,
    ...overrides,
  };
  return {
    deps,
    setProcesses: (next: string[]) => {
      processes = next;
    },
    asked,
    delivered,
    count: () => ({ recordings, changes }),
  };
}

describe("MeetingNotetaker", () => {
  it("asks once per call, records it, and hands the transcript on when the call ends", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gente-meetings-"));
    const h = harness({ meetingsDir: dir });
    const notetaker = new MeetingNotetaker(h.deps);
    h.setProcesses(["CptHost"]);
    await notetaker.check();
    await notetaker.check();
    expect(h.asked).toEqual(["Zoom"]);
    expect(notetaker.isRecording()).toBe(true);
    h.setProcesses([]);
    await notetaker.check();
    expect(notetaker.isRecording()).toBe(false);
    expect(h.delivered).toEqual(["Quote by Friday."]);
    expect(h.count()).toEqual({ recordings: 1, changes: 2 });
    const wav = await readFile(path.join(dir, "2026-11-20T10-00-00-000Z.wav"));
    expect(wav.length).toBe(44 + 8);
  });

  it("does not ask again about a call the person declined, until it ends", async () => {
    const h = harness({ askConsent: async () => false });
    const notetaker = new MeetingNotetaker(h.deps);
    h.setProcesses(["CptHost"]);
    await notetaker.check();
    await notetaker.check();
    expect(h.count().recordings).toBe(0);
    h.setProcesses([]);
    await notetaker.check();
    h.setProcesses(["CptHost"]);
    let asked = 0;
    h.deps.askConsent = async () => {
      asked++;
      return false;
    };
    await notetaker.check();
    expect(asked).toBe(1);
  });

  it("keeps a call started from the menu going until the menu stops it, and skips silence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gente-meetings-"));
    const h = harness({ meetingsDir: dir, record: () => ({ stop: async () => null }) });
    const notetaker = new MeetingNotetaker(h.deps);
    expect(await notetaker.startByHand()).toBe(true);
    await notetaker.check();
    expect(notetaker.isRecording()).toBe(true);
    expect(await notetaker.finish()).toBeNull();
    expect(h.delivered).toEqual([]);
  });
});

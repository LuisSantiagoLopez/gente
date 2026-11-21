import { describe, expect, it } from "vitest";
import { runActivitySteps, thoughtMs } from "./run-activity-steps";

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
const labels = { read: "Read your message", reply: "Wrote the reply" };

describe("run activity steps", () => {
  it("lists reading and writing for a plain chat, with times", () => {
    const activity = {
      runId: "r1",
      startedAt: at(0),
      firstOutputAt: at(1200),
      endedAt: at(3400),
      steps: [],
    };
    expect(runActivitySteps(activity, labels)).toEqual([
      {
        id: "read",
        label: "Read your message",
        status: "succeeded",
        startedAt: at(0),
        durationMs: 1200,
      },
      {
        id: "reply",
        label: "Wrote the reply",
        status: "succeeded",
        startedAt: at(1200),
        durationMs: 2200,
      },
    ]);
    expect(thoughtMs(activity, 0)).toBe(1200);
  });

  it("shows reading as running until the first words, then writing as running", () => {
    const reading = { runId: "r1", startedAt: at(0), steps: [] };
    expect(runActivitySteps(reading, labels)).toEqual([
      { id: "read", label: "Read your message", status: "running", startedAt: at(0) },
    ]);
    expect(thoughtMs(reading, Date.parse(at(500)))).toBe(500);
    const writing = { ...reading, firstOutputAt: at(800) };
    expect(runActivitySteps(writing, labels).map((step) => step.status)).toEqual([
      "succeeded",
      "running",
    ]);
  });

  it("keeps a tool run's own steps", () => {
    const steps = [
      { id: "e1", label: "Searching the web", status: "succeeded" as const, startedAt: at(0) },
    ];
    expect(runActivitySteps({ runId: "r1", startedAt: at(0), steps }, labels)).toBe(steps);
  });

  it("has nothing to list before the run starts", () => {
    expect(runActivitySteps(undefined, labels)).toEqual([]);
    expect(runActivitySteps({ runId: "r1", steps: [] }, labels)).toEqual([]);
  });
});

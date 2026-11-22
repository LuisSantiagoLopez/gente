import type { RunActivity } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  activityTimeline,
  latestThought,
  pastTenseLabel,
  thoughtMs,
  toolStepCount,
  unsavedThinking,
  workedMs,
} from "./run-activity-steps";

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

const activity: RunActivity = {
  runId: "r1",
  startedAt: at(0),
  firstOutputAt: at(4_000),
  endedAt: at(70_000),
  steps: [
    {
      id: "thought-0",
      kind: "thought",
      label: "",
      output: "Plan the page.\nPick a name.",
      status: "succeeded",
      startedAt: at(0),
    },
    {
      id: "e1",
      label: "Asking you: Which name?",
      status: "succeeded",
      startedAt: at(5_000),
    },
    { id: "e2", label: "Writing index.html", status: "succeeded", startedAt: at(65_000) },
  ],
};

describe("run activity row", () => {
  it("lists only real thoughts and tool steps, with no filler rows", () => {
    expect(activityTimeline(activity).map((step) => step.id)).toEqual(["thought-0", "e1", "e2"]);
    expect(activityTimeline({ runId: "r2", startedAt: at(0), steps: [] })).toEqual([]);
  });

  it("counts tool steps and leaves out the wait for a question's answer", () => {
    expect(toolStepCount(activity)).toBe(2);
    expect(thoughtMs(activity, 0)).toBe(4_000);
    // 70 s from start to end, less the 60 s between the question and the next step.
    expect(workedMs(activity, 0)).toBe(10_000);
  });

  it("previews the newest thought on one line and shows only unsaved live thinking", () => {
    expect(latestThought(activity, "")).toBe("Pick a name.");
    expect(latestThought(activity, "Now the menu.")).toBe("Now the menu.");
    expect(unsavedThinking(activity, "Plan the page.\nPick a name. Then check it.")).toBe(
      "Then check it.",
    );
  });

  it("says finished steps in plain past words", () => {
    expect(pastTenseLabel("Writing index.html")).toBe("Wrote index.html");
    expect(pastTenseLabel("Searching the web: coffee")).toBe("Searched the web: coffee");
    expect(pastTenseLabel("Asking you: Which name?")).toBe("Asked you: Which name?");
  });
});

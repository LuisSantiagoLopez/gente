import { describe, expect, it } from "vitest";
import { projectRunActivity } from "./run-activity.js";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

describe("run activity", () => {
  it("lists each step with its input, output, status and time, kept after the run ends", () => {
    const [activity] = projectRunActivity([
      { type: "run.started", runId: "r1", createdAt: at(0), payload: {} },
      {
        type: "agent.tool.called",
        runId: "r1",
        createdAt: at(1),
        payload: {
          name: "web_search",
          executionId: "e1",
          label: "Searching the web",
          input: '{"query":"weather"}',
        },
      },
      {
        type: "agent.tool.completed",
        runId: "r1",
        createdAt: at(3),
        payload: { executionId: "e1", outcome: "succeeded", durationMs: 2000, output: "Sunny" },
      },
      {
        type: "agent.tool.called",
        runId: "r1",
        createdAt: at(4),
        payload: { name: "write_file", executionId: "e2" },
      },
      { type: "run.completed", runId: "r1", createdAt: at(5), payload: {} },
    ]);
    expect(activity).toEqual({
      runId: "r1",
      startedAt: at(0),
      endedAt: at(5),
      steps: [
        {
          id: "e1",
          label: "Searching the web",
          input: '{"query":"weather"}',
          output: "Sunny",
          status: "succeeded",
          startedAt: at(1),
          durationMs: 2000,
        },
        // Still running when the run ended, so it was stopped with it.
        { id: "e2", label: "Write file", status: "stopped", startedAt: at(4) },
      ],
    });
  });

  it("ignores a repeated event and events of other kinds", () => {
    const called = {
      type: "agent.tool.called",
      runId: "r1",
      createdAt: at(1),
      payload: { name: "remember", executionId: "e1" },
    };
    const activity = projectRunActivity([
      called,
      called,
      { type: "thread.progress", runId: "r1", createdAt: at(2), payload: { delta: "x" } },
    ]);
    expect(activity[0]?.steps).toHaveLength(1);
  });
});

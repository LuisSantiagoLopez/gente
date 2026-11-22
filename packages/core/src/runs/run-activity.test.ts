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

  it("records when a plain chat's first words appeared, once", () => {
    const [activity] = projectRunActivity([
      { type: "run.started", runId: "r2", createdAt: at(0), payload: {} },
      { type: "thread.progress", runId: "r2", createdAt: at(1), payload: { streaming: true } },
      { type: "thread.progress", runId: "r2", createdAt: at(2), payload: { text: "Hey" } },
      { type: "thread.progress", runId: "r2", createdAt: at(3), payload: { delta: " there" } },
      {
        type: "thread.message.created",
        runId: "r2",
        createdAt: at(4),
        payload: { role: "bot" },
      },
      { type: "run.completed", runId: "r2", createdAt: at(5), payload: {} },
    ]);
    expect(activity).toEqual({
      runId: "r2",
      startedAt: at(0),
      firstOutputAt: at(2),
      endedAt: at(5),
      steps: [],
    });
  });

  it("puts each stretch of thinking in the timeline before the step it led to", () => {
    const [activity] = projectRunActivity([
      { type: "run.started", runId: "r1", createdAt: at(0), payload: {} },
      {
        type: "run.thought",
        runId: "r1",
        createdAt: at(4),
        payload: { text: "Plan the page.", durationMs: 3000 },
      },
      {
        type: "agent.tool.called",
        runId: "r1",
        createdAt: at(5),
        payload: { name: "write_file", executionId: "e1" },
      },
      { type: "run.thought", runId: "r1", createdAt: at(8), payload: { text: "Now reply." } },
      { type: "run.completed", runId: "r1", createdAt: at(9), payload: {} },
    ]);
    expect(activity?.steps.map((step) => [step.kind ?? "tool", step.output ?? step.label])).toEqual(
      [
        ["thought", "Plan the page."],
        ["tool", "Write file"],
        ["thought", "Now reply."],
      ],
    );
    expect(activity?.steps[0]).toMatchObject({ startedAt: at(1), durationMs: 3000 });
  });

  it("shows a question card as done even when its end is reported before its start", () => {
    const [activity] = projectRunActivity([
      { type: "run.started", runId: "r1", createdAt: at(0), payload: {} },
      {
        type: "agent.tool.completed",
        runId: "r1",
        createdAt: at(2),
        payload: { name: "ask_user", executionId: "e1", outcome: "paused" },
      },
      {
        type: "agent.tool.called",
        runId: "r1",
        createdAt: at(2),
        payload: { name: "ask_user", executionId: "e1", label: "Asking you: Which city?" },
      },
    ]);
    expect(activity?.steps).toMatchObject([
      { id: "e1", label: "Asking you: Which city?", status: "succeeded" },
    ]);
  });
});

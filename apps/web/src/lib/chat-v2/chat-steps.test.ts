// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Tests for tool steps, question cards, failures and loaded chats in the chat-state reducer,
// with event shapes copied from a real run's stream (`agent.tool.called` and friends).
import { describe, expect, it } from "vitest";
import { activitySummary, SILENT_WRITE_MS, stepVerb } from "./activity-summary";
import { chatFromSnapshot, mergeChat } from "./chat-snapshot";
import { foldChat, reduceChat } from "./chat-state";
import type { ChatEvent, ToolStep } from "./chat-types";

const T = Date.parse("2026-11-22T22:48:00.000Z");
let seq = 100;
const at = (s: number) => new Date(T + s * 1000).toISOString();
const ev = (type: string, s: number, payload: Record<string, unknown> = {}): ChatEvent => ({
  type,
  seq: ++seq,
  threadId: "t1",
  botId: "b1",
  runId: type === "thread.message.created" && payload.role === "user" ? null : "r1",
  createdAt: at(s),
  payload,
});
const user = (s: number) =>
  ev("thread.message.created", s, {
    seq: 9,
    role: "user",
    messageId: "u1",
    blocks: [{ kind: "text", text: "make an app, just make a nice frontend" }],
    runIds: ["r1"],
  });

const appRun: ChatEvent[] = [
  user(0),
  ev("run.started", 0, { trigger: "user" }),
  ev("thread.progress", 4, { draft: { thinking: "A landing page. " }, streaming: true }),
  ev("thread.progress", 5, { draft: { thinking: "Write index.html." }, streaming: true }),
  ev("thread.progress", 40, {
    draft: { tool: { name: "write_file", args: '{"path":"site/index.html","content":"<html>' } },
  }),
  ev("run.thought", 40, { text: "A landing page. Write index.html.", durationMs: 36000 }),
  ev("agent.tool.called", 40, {
    name: "write_file",
    label: "Writing index.html",
    input: '{"path":"site/index.html"}',
    executionId: "x1",
  }),
  ev("agent.tool.completed", 41, {
    name: "write_file",
    outcome: "succeeded",
    durationMs: 900,
    output: "Wrote 5 KB",
    executionId: "x1",
  }),
  ev("thread.progress", 50, { text: "Done! ", shown: true, streaming: true }),
  ev("thread.progress", 51, { delta: "Open index.html.", shown: true, streaming: true }),
  ev("thread.message.created", 52, {
    seq: 11,
    role: "bot",
    messageId: "m1",
    blocks: [{ kind: "text", text: "Done! Open index.html." }],
  }),
  ev("run.completed", 52),
];

describe("a run with a tool step", () => {
  const chat = foldChat(appRun);
  const view = chat.turns[0]!.assistant!;

  it("puts thinking and the step in the order they happened", () => {
    expect(view.steps.map((s) => s.kind)).toEqual(["thought", "tool"]);
    expect(view.steps[0]).toMatchObject({ text: "A landing page. Write index.html." });
    expect(view.steps[1]).toMatchObject({
      label: "Writing index.html",
      status: "succeeded",
      durationMs: 900,
      output: "Wrote 5 KB",
    });
  });

  it("says Worked for … · 1 step when done", () => {
    const summary = activitySummary(view, T + 60_000);
    expect(summary).toEqual({ kind: "done", ms: 52_000, tools: 1, thoughts: 1, failed: false });
  });

  it("names the finished step in past words", () => {
    expect(stepVerb(view.steps[1] as ToolStep)).toBe("Wrote index.html");
  });

  it("shows the file being written while its call streams in", () => {
    const mid = foldChat(appRun.slice(0, 5)).turns[0]!.assistant!;
    expect(mid.toolDraft?.name).toBe("write_file");
    const summary = activitySummary(mid, T + 41_000);
    expect(summary).toMatchObject({ kind: "working", label: "Writing index.html…" });
  });

  it("shows the running step with a timer", () => {
    const mid = foldChat(appRun.slice(0, 7)).turns[0]!.assistant!;
    expect(activitySummary(mid, T + 40_500)).toEqual({
      kind: "working",
      label: "Writing index.html…",
      preview: "",
      since: T + 40_000,
    });
  });

  it("says Writing… after thinking stops but the model is still busy", () => {
    const mid = foldChat(appRun.slice(0, 4)).turns[0]!.assistant!;
    expect(activitySummary(mid, T + 5_000 + SILENT_WRITE_MS - 1)).toMatchObject({
      label: "Thinking…",
      preview: "A landing page. Write index.html.",
    });
    expect(activitySummary(mid, T + 5_000 + SILENT_WRITE_MS)).toMatchObject({
      label: "Writing…",
      since: T + 5_000,
    });
  });
});

describe("question cards and endings", () => {
  it("keeps a question card as a card and waits", () => {
    const chat = foldChat([
      user(0),
      ev("run.started", 0),
      ev("agent.tool.called", 2, { name: "ask_user", label: "Asking you", executionId: "a1" }),
      ev("agent.tool.completed", 2, { name: "ask_user", outcome: "paused", executionId: "a1" }),
      ev("thread.message.created", 2, {
        seq: 10,
        role: "bot",
        messageId: "ask1",
        blocks: [{ kind: "ask", text: "What kind of app?", status: "pending" }],
      }),
      ev("run.waiting_input", 3),
    ]);
    const view = chat.turns[0]!.assistant!;
    expect(view.cards.map((c) => c.message.id)).toEqual(["ask1"]);
    expect(view.parts).toEqual([]);
    expect(view.status).toBe("waiting");
    expect(view.steps[0]).toMatchObject({ status: "succeeded", label: "Asking you" });
    expect(activitySummary(view, T)).toEqual({ kind: "waiting" });
  });

  it("marks a failed run and stops running steps", () => {
    const chat = foldChat([
      user(0),
      ev("run.started", 0),
      ev("agent.tool.called", 1, { name: "shell", label: "Running a command", executionId: "s1" }),
      ev("run.failed", 3, { error: "model went away" }),
    ]);
    const view = chat.turns[0]!.assistant!;
    expect(view.status).toBe("failed");
    expect(view.error).toBe("model went away");
    expect(view.steps[0]).toMatchObject({ status: "stopped" });
  });

  it("hides the line for a plain reply with nothing to open", () => {
    const chat = foldChat([
      user(0),
      ev("run.started", 0),
      ev("thread.progress", 1, { text: "Hi!" }),
      ev("run.completed", 2),
    ]);
    expect(activitySummary(chat.turns[0]!.assistant, T + 3000)).toEqual({ kind: "hidden" });
  });

  it("skips an event it has already applied", () => {
    const once = foldChat(appRun.slice(0, 4));
    expect(reduceChat(once, appRun[3]!)).toBe(once);
  });

  it("clears everything on thread.cleared", () => {
    expect(reduceChat(foldChat(appRun), ev("thread.cleared", 60)).turns).toEqual([]);
  });
});

describe("a loaded chat", () => {
  const snapshot = {
    cursor: 500,
    messages: [
      {
        id: "u1",
        seq: 9,
        role: "user" as const,
        runId: "r1",
        blocks: [{ kind: "text" as const, text: "explain rainbows" }],
      },
      {
        id: "progress:r1",
        role: "bot" as const,
        runId: "r1",
        blocks: [
          { kind: "progress" as const, text: "Light bends", thinking: "Saved part. New part" },
        ],
      },
    ],
    runActivity: [
      {
        runId: "r1",
        startedAt: at(0),
        steps: [
          {
            id: "thought-0",
            kind: "thought" as const,
            label: "",
            output: "Saved part.",
            status: "succeeded" as const,
            startedAt: at(1),
          },
        ],
      },
    ],
    activeRuns: [{ id: "r1", status: "running" }],
  };

  it("opens mid-run with the live reply and only the unsaved thinking", () => {
    const view = chatFromSnapshot(snapshot).turns[0]!.assistant!;
    expect(view.status).toBe("working");
    expect(view.parts).toMatchObject([{ key: "text-0", text: "Light bends", streaming: true }]);
    expect(view.liveThought).toBe("New part");
    expect(view.steps).toHaveLength(1);
  });

  it("keeps the live text when a reload arrives that knows less", () => {
    const live = reduceChat(chatFromSnapshot(snapshot), {
      type: "thread.progress",
      seq: 501,
      runId: "r1",
      createdAt: at(5),
      payload: { delta: " in drops" },
    });
    const merged = mergeChat(live, chatFromSnapshot(snapshot));
    expect(merged.turns[0]!.assistant!.parts[0]).toMatchObject({
      key: "text-0",
      text: "Light bends in drops",
    });
  });
});

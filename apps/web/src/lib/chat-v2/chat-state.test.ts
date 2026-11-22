// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Tests for the chat-state reducer, replaying event streams recorded from real runs of the
// local model (yourai-default) on a test stack. Fixtures are in __fixtures__/.
import { describe, expect, it } from "vitest";
import hey from "./__fixtures__/hey.json";
import makeApp from "./__fixtures__/make-app.json";
import rainbows from "./__fixtures__/rainbows-think.json";
import { replay, replyKeysOverTime } from "./chat-replay.test-helper";
import type { ChatEvent } from "./chat-types";

const runOf = (events: readonly ChatEvent[]) =>
  events.find((e) => e.type === "run.started")!.runId!;

describe("hey (plain reply, no thinking, no tools)", () => {
  const events = hey as ChatEvent[];
  const { chat, states } = replay(events);
  const runId = runOf(events);

  it("makes one turn: the person's message and the answer", () => {
    expect(chat.turns).toHaveLength(1);
    expect(chat.turns[0]!.user?.blocks).toEqual([{ kind: "text", text: "hey" }]);
    expect(chat.turns[0]!.assistant?.runId).toBe(runId);
  });

  it("ends done with the saved reply and no steps", () => {
    const view = chat.turns[0]!.assistant!;
    expect(view.status).toBe("done");
    expect(view.steps).toEqual([]);
    expect(view.thinkingText).toBe("");
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0]!.streaming).toBe(false);
    expect(view.replyText).toMatch(/^Hey there!/);
  });

  it("keeps one key for the reply from the first token to the saved message", () => {
    expect(replyKeysOverTime(states, runId)).toEqual([`${chat.turns[0]!.id}/text-0`]);
  });

  it("never shows two turns for the run", () => {
    for (const state of states)
      expect(state.turns.filter((t) => t.assistant?.runId === runId).length).toBeLessThanOrEqual(1);
  });

  it("streams the text token by token", () => {
    const lengths = states.map(
      (s) => s.turns.find((t) => t.assistant?.runId === runId)?.assistant?.replyText.length ?? 0,
    );
    const grew = lengths.filter((n, i) => i > 0 && n > lengths[i - 1]!).length;
    expect(grew).toBeGreaterThanOrEqual(5);
  });
});

describe("rainbows (thinking streamed live, then the reply)", () => {
  const events = rainbows as ChatEvent[];
  const { chat, states } = replay(events);
  const runId = runOf(events);
  const viewAt = (i: number) =>
    states[i]!.turns.find((t) => t.assistant?.runId === runId)?.assistant;

  it("shows the thinking while it streams, before any reply text", () => {
    const firstDraft = events.findIndex(
      (e) => (e.payload?.draft as { thinking?: string })?.thinking,
    );
    const view = viewAt(firstDraft + 1)!;
    expect(view.status).toBe("working");
    expect(view.liveThought.length).toBeGreaterThan(0);
    expect(view.replyText).toBe("");
  });

  it("grows the live thought many times", () => {
    const sizes = states.map((_, i) => viewAt(i)?.thinkingText.length ?? 0);
    const grew = sizes.filter((n, i) => i > 0 && n > sizes[i - 1]!).length;
    expect(grew).toBeGreaterThan(100);
  });

  it("turns the streamed thought into one saved thought step", () => {
    const view = chat.turns.at(-1)!.assistant!;
    const thoughts = view.steps.filter((s) => s.kind === "thought");
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]).toMatchObject({ kind: "thought" });
    expect(thoughts[0]!.kind === "thought" && thoughts[0]!.provisional).toBeFalsy();
    expect(view.liveThought).toBe("");
    const saved = events.find((e) => e.type === "run.thought")!.payload!.text as string;
    expect(thoughts[0]!.kind === "thought" && thoughts[0]!.text).toBe(saved.trim());
  });

  it("records when the first thought and the first token came", () => {
    const view = chat.turns.at(-1)!.assistant!;
    expect(view.firstThoughtAt).toBeDefined();
    expect(view.firstTokenAt).toBeGreaterThan(view.firstThoughtAt!);
    expect(view.startedAt).toBeLessThanOrEqual(view.firstThoughtAt!);
  });

  it("keeps the reply in one place and ends done", () => {
    const view = chat.turns.at(-1)!.assistant!;
    expect(view.status).toBe("done");
    expect(view.parts.map((p) => [p.key, p.streaming])).toEqual([["text-0", false]]);
    expect(replyKeysOverTime(states, runId)).toEqual([`${chat.turns.at(-1)!.id}/text-0`]);
  });
});

describe("make an app (thinking, five files written, then the model ran out of room)", () => {
  const events = makeApp as ChatEvent[];
  const { chat, states } = replay(events);
  const runId = runOf(events);
  const view = chat.turns.at(-1)!.assistant!;

  it("lists every real file step, finished, in order", () => {
    const tools = view.steps.filter((s) => s.kind === "tool");
    expect(tools).toHaveLength(5);
    expect(tools.every((s) => s.kind === "tool" && s.status === "succeeded")).toBe(true);
    expect(tools.map((s) => s.kind === "tool" && s.label)).toEqual(
      events
        .filter((e) => e.type === "agent.tool.called")
        .map((e) => (e.payload?.label as string) ?? "write file"),
    );
  });

  it("keeps the saved thoughts between the steps", () => {
    const thoughts = view.steps.filter((s) => s.kind === "thought" && !s.id.startsWith("note"));
    expect(thoughts.length).toBe(events.filter((e) => e.type === "run.thought").length);
    expect(view.steps[0]!.kind).toBe("thought");
  });

  it("ends failed with the model's error and nothing left running", () => {
    expect(view.status).toBe("failed");
    expect(view.error).toMatch(/context budget/);
    expect(view.liveThought).toBe("");
    expect(view.toolDraft).toBeUndefined();
  });

  it("shows the saved message once, not the streamed copy too", () => {
    expect(view.parts.map((p) => p.streaming)).toEqual([false]);
    expect(view.replyText).toMatch(/^I'll make a visually stunning/);
  });

  it("never splits the run over two turns", () => {
    for (const state of states)
      expect(state.turns.filter((t) => t.assistant?.runId === runId).length).toBeLessThanOrEqual(1);
  });
});

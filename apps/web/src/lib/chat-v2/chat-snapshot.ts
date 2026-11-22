// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Turns a loaded chat (the thread snapshot: saved messages, each run's saved steps and
// thoughts, which runs still work) into chat turns, and merges a reloaded chat into the live
// state without losing what is streaming. Used by use-chat-state.ts; the live events after it
// go through chat-state.ts.
import type { RunActivity, RunActivityStep, ThreadMessage } from "@rakazo/contracts";
import { isRunWorking } from "@rakazo/core";
import { addMessage } from "./chat-state";
import {
  ms,
  placeRun,
  turnIndexOfRun,
  UNKNOWN_SEQ,
  updateAssistant,
  withLiveText,
} from "./chat-turns";
import type { AssistantView, ChatState, Step, Turn } from "./chat-types";

/** The parts of a thread snapshot the chat screen reads. */
export type ChatSnapshot = {
  cursor?: number;
  messages: readonly (Omit<ThreadMessage, "threadId" | "seq" | "createdAt"> &
    Partial<Pick<ThreadMessage, "threadId" | "seq" | "createdAt">>)[];
  runActivity?: readonly RunActivity[];
  run?: { id: string; status: string } | null;
  activeRuns?: readonly { id: string; status: string }[];
};

function toStep(step: RunActivityStep): Step {
  const startedAt = ms(step.startedAt);
  const timing = {
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
  };
  if (step.kind === "thought")
    return { kind: "thought", id: step.id, text: step.output ?? "", ...timing };
  return {
    kind: "tool",
    id: step.id,
    name: "",
    label: step.label,
    status: step.status,
    ...(step.input ? { input: step.input } : {}),
    ...(step.output ? { output: step.output } : {}),
    ...timing,
  };
}

/** Thinking streamed since the last saved thought (the live text holds the whole run's). */
function unsavedThinking(steps: readonly Step[], live: string): string {
  const text = live.trim();
  const saved = steps
    .findLast((step) => step.kind === "thought")
    ?.text.replace(/…$/, "")
    .trim();
  if (!text || !saved) return text;
  const end = text.lastIndexOf(saved);
  return end < 0 ? text : text.slice(end + saved.length).trim();
}

function withActivity(view: AssistantView, activity: RunActivity, working: boolean) {
  const steps = activity.steps.map(toStep);
  return {
    ...view,
    steps,
    thinkingText: steps
      .filter((step) => step.kind === "thought")
      .map((step) => (step.kind === "thought" ? step.text : ""))
      .join("\n\n"),
    startedAt: ms(activity.startedAt) ?? view.startedAt,
    endedAt: working ? undefined : ms(activity.endedAt),
    firstTokenAt: ms(activity.firstOutputAt) ?? view.firstTokenAt,
    status: working ? view.status : view.status === "working" ? "done" : view.status,
  } satisfies AssistantView;
}

/** Builds the turns of a loaded chat. */
export function chatFromSnapshot(snapshot: ChatSnapshot): ChatState {
  const working = new Set(
    [...(snapshot.activeRuns ?? []), ...(snapshot.run ? [snapshot.run] : [])]
      .filter((run) => isRunWorking(run.status) || run.status === "waiting_input")
      .map((run) => run.id),
  );
  const waiting = new Set(
    (snapshot.activeRuns ?? []).filter((r) => r.status === "waiting_input").map((r) => r.id),
  );
  let state: ChatState = { turns: [], cursor: snapshot.cursor ?? -1 };
  const live = [];
  const ordered = [...snapshot.messages].sort(
    (a, b) => (a.seq ?? UNKNOWN_SEQ) - (b.seq ?? UNKNOWN_SEQ),
  );
  for (const raw of ordered) {
    if (raw.id.startsWith("progress:")) {
      live.push(raw);
      continue;
    }
    const message = {
      ...raw,
      threadId: raw.threadId ?? "",
      seq: raw.seq ?? UNKNOWN_SEQ,
      createdAt: raw.createdAt ?? new Date(0).toISOString(),
    } as ThreadMessage;
    state = addMessage(state, message);
  }
  for (const activity of snapshot.runActivity ?? []) {
    const held = turnIndexOfRun(state, activity.runId);
    const asked = state.turns.some((turn) => {
      const runIds = (turn.user as { runIds?: unknown } | undefined)?.runIds;
      return Array.isArray(runIds) && runIds.includes(activity.runId);
    });
    if (held < 0 && !asked && !working.has(activity.runId)) continue;
    const placed = placeRun(state, activity.runId, UNKNOWN_SEQ);
    state = updateAssistant(placed.state, placed.index, (view) =>
      withActivity(view, activity, working.has(activity.runId)),
    );
  }
  for (const runId of working) {
    const index = turnIndexOfRun(state, runId);
    const placed = index >= 0 ? { state, index } : placeRun(state, runId, UNKNOWN_SEQ);
    state = updateAssistant(placed.state, placed.index, (view) => ({
      ...view,
      status: waiting.has(runId) ? "waiting" : "working",
      endedAt: undefined,
    }));
  }
  for (const message of live) {
    if (!message.runId) continue;
    const index = turnIndexOfRun(state, message.runId);
    if (index < 0) continue;
    const block = message.blocks.findLast((b) => b.kind === "progress");
    if (block?.kind !== "progress") continue;
    state = updateAssistant(state, index, (view) => {
      const withText = block.activity || !block.text ? view : withLiveText(view, block.text);
      return {
        ...withText,
        liveThought: unsavedThinking(view.steps, block.thinking ?? ""),
        thinkingText: view.thinkingText || (block.thinking ?? ""),
        ...(block.toolDraft ? { toolDraft: block.toolDraft } : {}),
      };
    });
  }
  return state;
}

const ENDED = new Set(["done", "failed", "stopped"]);

function mergeAssistant(live: AssistantView, loaded: AssistantView): AssistantView {
  // The live stream knows more about a run it watched; the load knows about saved things.
  const liveStreaming = live.parts.find((part) => part.streaming);
  const loadedSaved = loaded.parts.filter((part) => !part.streaming);
  const keepLiveText = liveStreaming && !loadedSaved.some((part) => part.key === liveStreaming.key);
  return {
    ...loaded,
    status: ENDED.has(live.status) ? live.status : loaded.status,
    steps: live.steps.length >= loaded.steps.length ? live.steps : loaded.steps,
    liveThought: live.liveThought || loaded.liveThought,
    thinkingText:
      live.thinkingText.length >= loaded.thinkingText.length
        ? live.thinkingText
        : loaded.thinkingText,
    parts: keepLiveText ? [...loadedSaved, liveStreaming] : loaded.parts,
    replyText:
      keepLiveText && liveStreaming
        ? [...loadedSaved.map((p) => p.text), liveStreaming.text].filter(Boolean).join("\n\n")
        : loaded.replyText,
    toolDraft: live.toolDraft ?? loaded.toolDraft,
    startedAt: live.startedAt ?? loaded.startedAt,
    endedAt: live.endedAt ?? loaded.endedAt,
    firstThoughtAt: live.firstThoughtAt ?? loaded.firstThoughtAt,
    firstTokenAt: live.firstTokenAt ?? loaded.firstTokenAt,
    error: live.error ?? loaded.error,
  };
}

/** Merges a freshly loaded chat into the live state. Live-only turns that are newer stay. */
export function mergeChat(live: ChatState, loaded: ChatState): ChatState {
  const liveByRun = new Map<string, AssistantView>();
  for (const turn of live.turns)
    if (turn.assistant?.runId) liveByRun.set(turn.assistant.runId, turn.assistant);
  const turns: Turn[] = loaded.turns.map((turn) => {
    const prior = turn.assistant?.runId ? liveByRun.get(turn.assistant.runId) : undefined;
    return prior && turn.assistant
      ? { ...turn, assistant: mergeAssistant(prior, turn.assistant) }
      : turn;
  });
  const ids = new Set(turns.map((turn) => turn.id));
  const runs = new Set(turns.map((turn) => turn.assistant?.runId).filter(Boolean));
  const newest = turns.at(-1)?.seq ?? -1;
  for (const turn of live.turns) {
    if (ids.has(turn.id) || (turn.assistant?.runId && runs.has(turn.assistant.runId))) continue;
    if (turn.seq >= newest) turns.push(turn);
  }
  return { turns, cursor: Math.max(live.cursor, loaded.cursor) };
}

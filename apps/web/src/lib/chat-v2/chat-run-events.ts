// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// How one live event changes one AI answer: streamed thinking and reply text, a tool call being
// written, a tool step starting or ending, a saved thought, and the run pausing or ending.
// Pure. Called by chat-state.ts (reduceChat), which finds the answer an event belongs to.
import { humanizeToolName } from "@rakazo/core";
import { liveText, withLiveText } from "./chat-turns";
import type { AssistantView, ChatEvent, Step, ToolStep } from "./chat-types";

export const str = (value: unknown) => (typeof value === "string" ? value : undefined);
export const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;

/** Turns the thought streaming now into a step, until its saved copy arrives. */
export function closeLiveThought(view: AssistantView, at?: number): AssistantView {
  if (!view.liveThought.trim()) return view.liveThought ? { ...view, liveThought: "" } : view;
  const startedAt = view.steps.length === 0 ? view.firstThoughtAt : undefined;
  const step: Step = {
    kind: "thought",
    id: `thought-${view.steps.length}`,
    text: view.liveThought.trim(),
    provisional: true,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(startedAt !== undefined && at !== undefined ? { durationMs: at - startedAt } : {}),
  };
  return { ...view, liveThought: "", steps: [...view.steps, step] };
}

export function savedThought(view: AssistantView, text: string, durationMs?: number, at?: number) {
  const startedAt = at !== undefined && durationMs !== undefined ? at - durationMs : at;
  const saved = { text, ...(durationMs !== undefined ? { durationMs } : {}), startedAt };
  const index = view.steps.findIndex((step) => step.kind === "thought" && step.provisional);
  if (index >= 0) {
    const steps = view.steps.slice();
    steps[index] = { kind: "thought", id: steps[index]!.id, ...saved };
    return { ...view, steps };
  }
  const step: Step = { kind: "thought", id: `thought-${view.steps.length}`, ...saved };
  return { ...view, liveThought: "", steps: [...view.steps, step] };
}

export function applyProgress(view: AssistantView, payload: Record<string, unknown>, at?: number) {
  let next = view;
  const draft = (payload.draft ?? {}) as Record<string, unknown>;
  if (draft.reset === true) next = { ...closeLiveThought(next, at), toolDraft: undefined };
  const thinking = str(draft.thinking);
  if (thinking) {
    next = {
      ...next,
      liveThought: next.liveThought + thinking,
      thinkingText: next.thinkingText + thinking,
      firstThoughtAt: next.firstThoughtAt ?? at,
      lastStreamAt: at,
    };
  }
  const tool = draft.tool as { name?: unknown; args?: unknown } | undefined;
  if (tool && typeof tool.name === "string" && typeof tool.args === "string") {
    const prior = next.toolDraft?.name === tool.name ? next.toolDraft : undefined;
    next = {
      ...closeLiveThought(next, at),
      toolDraft: {
        name: tool.name,
        args: (prior?.args ?? "") + tool.args,
        startedAt: prior?.startedAt ?? at,
      },
    };
  }
  // A status line ("activity") is not reply text; a reset drops text that will not be kept.
  if (payload.activity === true) return payload.reset === true ? withLiveText(next, "") : next;
  const text = str(payload.text);
  const delta = str(payload.delta);
  if (payload.reset === true && text === undefined) next = withLiveText(next, "");
  if (text !== undefined || delta !== undefined) {
    const full = text !== undefined ? text : liveText(next) + (delta ?? "");
    next = { ...withLiveText(closeLiveThought(next, at), full, at), lastStreamAt: at };
  }
  return next;
}

export function toolStarted(view: AssistantView, payload: Record<string, unknown>, at?: number) {
  const id = String(payload.executionId ?? `tool-${view.steps.length}`);
  const name = String(payload.name ?? "");
  const label = str(payload.label) ?? humanizeToolName(name);
  const input = str(payload.input);
  const closed = { ...closeLiveThought(view, at), toolDraft: undefined, lastStreamAt: undefined };
  if (closed.steps.some((step) => step.id === id)) {
    const steps = closed.steps.map((step) =>
      step.id === id && step.kind === "tool"
        ? { ...step, label, ...(input ? { input } : {}) }
        : step,
    );
    return { ...closed, steps };
  }
  const step: ToolStep = {
    kind: "tool",
    id,
    name,
    label,
    status: "running",
    ...(input ? { input } : {}),
    ...(at !== undefined ? { startedAt: at } : {}),
  };
  return { ...closed, steps: [...closed.steps, step] };
}

export function toolEnded(view: AssistantView, payload: Record<string, unknown>, at?: number) {
  const id = String(payload.executionId ?? "");
  const outcome = payload.outcome;
  const name = String(payload.name ?? "");
  // A question card is done once shown; another pause (an approval) ends later.
  if (outcome === "paused" && name !== "ask_user") return view;
  const finish = (step: ToolStep): ToolStep => {
    const output = str(payload.output) ?? str(payload.error);
    const durationMs = num(payload.durationMs);
    return {
      ...step,
      status: outcome === "succeeded" || outcome === "paused" ? "succeeded" : "failed",
      ...(output ? { output } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  };
  if (!view.steps.some((step) => step.id === id)) {
    const early: ToolStep = {
      kind: "tool",
      id: id || `tool-${view.steps.length}`,
      name,
      label: humanizeToolName(name),
      status: "running",
      ...(at !== undefined ? { startedAt: at } : {}),
    };
    return { ...view, steps: [...view.steps, finish(early)], lastStreamAt: undefined };
  }
  const steps = view.steps.map((step) =>
    step.id === id && step.kind === "tool" && step.status === "running" ? finish(step) : step,
  );
  return { ...view, steps, lastStreamAt: undefined };
}

export function runEnded(view: AssistantView, event: ChatEvent, at?: number): AssistantView {
  const closed = closeLiveThought(view, at);
  const status =
    event.type === "run.waiting_input"
      ? "waiting"
      : event.type === "run.failed"
        ? "failed"
        : event.type === "run.cancelled"
          ? "stopped"
          : "done";
  const ended = status !== "waiting";
  const error = str(event.payload?.error);
  return {
    ...closed,
    status,
    toolDraft: undefined,
    lastStreamAt: undefined,
    // Text still streaming when the run ends stays as it is; the saved message replaces it.
    ...(ended && at !== undefined ? { endedAt: at } : {}),
    ...(error ? { error } : {}),
    steps: ended
      ? closed.steps.map((step) =>
          step.kind === "tool" && step.status === "running"
            ? { ...step, status: "stopped" as const }
            : step,
        )
      : closed.steps,
  };
}

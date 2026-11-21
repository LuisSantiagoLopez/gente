// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
// What a reply's activity row lists, worked out from the run's activity. Used by RunActivityRow.
import type { RunActivity, RunActivityStep } from "@rakazo/contracts";

function at(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** How long the run read and thought before its first words: until now while it still thinks. */
export function thoughtMs(activity: RunActivity | undefined, now: number): number | undefined {
  const start = at(activity?.startedAt);
  if (start === undefined) return undefined;
  const end = at(activity?.firstOutputAt) ?? at(activity?.endedAt) ?? now;
  return Math.max(0, end - start);
}

/**
 * The steps a run's activity row lists. A run that used tools lists its tool calls. A plain
 * chat lists what it did too: reading the message, then writing the reply, each with its time.
 */
export function runActivitySteps(
  activity: RunActivity | undefined,
  labels: { read: string; reply: string },
): RunActivityStep[] {
  if (!activity) return [];
  if (toolStepCount(activity) > 0) return activity.steps;
  const start = at(activity.startedAt);
  if (start === undefined) return [];
  // Gente: a plain chat that thought shows its thinking, then the reply.
  const thoughts = activity.steps;
  const first = at(activity.firstOutputAt);
  const end = at(activity.endedAt);
  const read: RunActivityStep = {
    id: "read",
    label: labels.read,
    status: first !== undefined || end !== undefined ? "succeeded" : "running",
    startedAt: activity.startedAt!,
    ...(first !== undefined || end !== undefined
      ? { durationMs: Math.max(0, (first ?? end!) - start) }
      : {}),
  };
  if (first === undefined) return thoughts.length ? thoughts : [read];
  return [
    ...(thoughts.length ? thoughts : [read]),
    {
      id: "reply",
      label: labels.reply,
      status: end === undefined ? "running" : "succeeded",
      startedAt: activity.firstOutputAt!,
      ...(end === undefined ? {} : { durationMs: Math.max(0, end - first) }),
    },
  ];
}

/** Gente: the tool calls a run made, leaving out its stretches of thinking. */
export function toolStepCount(activity: RunActivity | undefined): number {
  return activity?.steps.filter((step) => step.kind !== "thought").length ?? 0;
}

/**
 * Gente: thinking still streaming that is not yet saved as a step. The live text keeps
 * everything since the model's turn began, so the part already saved is cut off.
 */
export function unsavedThinking(activity: RunActivity | undefined, live: string | undefined) {
  const text = live?.trim() ?? "";
  if (!text) return "";
  const saved = activity?.steps
    .findLast((step) => step.kind === "thought")
    ?.output?.replace(/…$/, "")
    .trim();
  if (!saved) return text;
  const end = text.lastIndexOf(saved);
  return end < 0 ? text : text.slice(end + saved.length).trim();
}

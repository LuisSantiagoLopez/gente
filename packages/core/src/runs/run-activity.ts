// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { RunActivity, RunActivityStep } from "@rakazo/contracts";
import { humanizeToolName } from "../messages/events.js";

/** Runs whose activity a thread keeps, newest last. */
export const RUN_ACTIVITY_KEPT = 20;

type ActivityEvent = {
  type: string;
  runId?: string | null;
  createdAt: string | Date;
  payload?: unknown;
};

const iso = (value: string | Date) => (typeof value === "string" ? value : value.toISOString());

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Events that mark the reply's first words: streamed text or a posted bot message. */
function isFirstOutputEvent(event: { type: string; payload?: unknown }): boolean {
  const payload = record(event.payload);
  if (event.type === "thread.progress") return Boolean(text(payload.text) ?? text(payload.delta));
  return event.type === "thread.message.created" && payload.role === "bot";
}

/** Whether an event changes a run's activity list. */
export function isRunActivityEvent(event: {
  type: string;
  runId?: string | null;
  payload?: unknown;
}): boolean {
  return (
    Boolean(event.runId) &&
    (isFirstOutputEvent(event) ||
      event.type === "run.started" ||
      event.type === "run.thought" ||
      event.type === "agent.tool.called" ||
      event.type === "agent.tool.completed" ||
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled")
  );
}

function finishStep(step: RunActivityStep, payload: Record<string, unknown>): RunActivityStep {
  const outcome = payload.outcome;
  // Gente: a question card is done once shown; the answer comes back as the run resumes.
  // Other pauses (an approval) finish later under the same step.
  if (outcome === "paused")
    return payload.name === "ask_user" ? { ...step, status: "succeeded" } : step;
  const durationMs =
    typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
      ? Math.max(0, Math.round(payload.durationMs))
      : undefined;
  const output = text(payload.output) ?? text(payload.error);
  return {
    ...step,
    status: outcome === "succeeded" ? "succeeded" : "failed",
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(output ? { output } : {}),
  };
}

/** Applies one event to a run's activity. Events for other runs or types leave it as it is. */
export function reduceRunActivity(
  current: RunActivity | undefined,
  event: ActivityEvent,
): RunActivity | undefined {
  if (!event.runId || !isRunActivityEvent(event)) return current;
  const at = iso(event.createdAt);
  const activity: RunActivity = current ?? { runId: event.runId, steps: [] };
  const payload = record(event.payload);
  if (event.type === "thread.progress" || event.type === "thread.message.created") {
    // Only the first words count; later text leaves the activity as it is.
    if (current?.firstOutputAt || !isFirstOutputEvent(event)) return current;
    return { ...activity, firstOutputAt: at };
  }
  if (event.type === "run.started") {
    return { ...activity, startedAt: activity.startedAt ?? at, endedAt: undefined };
  }
  if (event.type === "run.thought") {
    // Gente: thinking sits in the timeline between the steps it came before.
    const thought = text(payload.text);
    if (!thought) return current;
    const durationMs =
      typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
        ? Math.max(0, Math.round(payload.durationMs))
        : undefined;
    const ended = Date.parse(at);
    return {
      ...activity,
      startedAt: activity.startedAt ?? at,
      steps: [
        ...activity.steps,
        {
          id: `thought-${activity.steps.length}`,
          kind: "thought",
          label: "",
          output: thought,
          status: "succeeded",
          startedAt:
            durationMs !== undefined && Number.isFinite(ended)
              ? new Date(ended - durationMs).toISOString()
              : at,
          ...(durationMs === undefined ? {} : { durationMs }),
        },
      ],
    };
  }
  if (event.type === "agent.tool.called") {
    const id = String(payload.executionId ?? `${activity.steps.length}`);
    const name = String(payload.name ?? "");
    const input = text(payload.input);
    const label = text(payload.label) ?? humanizeToolName(name);
    // Gente: a paused call (a question card) reports its end just before its start; the step
    // that end made keeps its status and gains its label and input here.
    if (activity.steps.some((step) => step.id === id)) {
      return {
        ...activity,
        steps: activity.steps.map((step) =>
          step.id === id ? { ...step, label, ...(input ? { input } : {}) } : step,
        ),
      };
    }
    return {
      ...activity,
      startedAt: activity.startedAt ?? at,
      steps: [
        ...activity.steps,
        {
          id,
          label,
          ...(input ? { input } : {}),
          status: "running",
          startedAt: at,
        },
      ],
    };
  }
  if (event.type === "agent.tool.completed") {
    const id = String(payload.executionId ?? "");
    if (id && !activity.steps.some((step) => step.id === id)) {
      const name = String(payload.name ?? "");
      const early = {
        id,
        label: humanizeToolName(name),
        status: "running" as const,
        startedAt: at,
      };
      return { ...activity, steps: [...activity.steps, finishStep(early, payload)] };
    }
    return {
      ...activity,
      steps: activity.steps.map((step) =>
        step.id === id && step.status === "running" ? finishStep(step, payload) : step,
      ),
    };
  }
  // The run ended: a call still running there was stopped with it.
  const tokens =
    typeof payload.tokens === "number" && Number.isFinite(payload.tokens)
      ? Math.max(0, Math.round(payload.tokens))
      : activity.tokens;
  return {
    ...activity,
    endedAt: at,
    ...(tokens === undefined ? {} : { tokens }),
    steps: activity.steps.map((step) =>
      step.status === "running" ? { ...step, status: "stopped" } : step,
    ),
  };
}

/** Folds events into the activity of each run they touch, keeping the newest runs. */
export function projectRunActivity(
  events: readonly ActivityEvent[],
  previous: readonly RunActivity[] = [],
): RunActivity[] {
  const byRun = new Map(previous.map((activity) => [activity.runId, activity]));
  for (const event of events) {
    if (!event.runId || !isRunActivityEvent(event)) continue;
    const before = byRun.get(event.runId);
    const next = reduceRunActivity(before, event);
    if (!next || next === before) continue;
    byRun.delete(event.runId);
    byRun.set(event.runId, next);
  }
  return [...byRun.values()].slice(-RUN_ACTIVITY_KEPT);
}

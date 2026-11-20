// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type {
  Goal,
  ProactiveAction,
  ProactiveActionKind,
  ProactiveDigest,
  ProactiveState,
  ProactiveTrigger,
  ProactiveVerdict,
} from "@rakazo/contracts";
import { ClientError } from "../primitives/client-error.js";
import { buildDigest, goalTaste } from "./proactive-digest.js";
import type { ProactiveEvent } from "./proactive-policy.js";
import {
  goalsDue,
  localClock,
  mayNotify,
  minutesUsedOnDay,
  proactiveRisk,
  trimProactiveState,
} from "./proactive-policy.js";

export type PlannedAction = {
  kind: ProactiveActionKind;
  title: string;
  instructions: string;
  minutes: number;
};

/**
 * Everything the engine touches, so the same engine runs against the database and models in the
 * app and against a fake clock and a scripted planner in the simulation.
 */
export interface ProactivePorts {
  now(): Date;
  newId(): string;
  loadGoals(): Promise<Goal[]>;
  loadState(): Promise<ProactiveState>;
  /** Reads, changes and saves the state as one step. */
  updateState(change: (state: ProactiveState) => ProactiveState): Promise<ProactiveState>;
  plan(input: {
    goal: Goal;
    trigger: ProactiveTrigger;
    event?: string;
    room: number;
    accepted: string[];
    rejected: string[];
    recent: string[];
  }): Promise<PlannedAction[]>;
  /** Starts a normal bot run for the action; its own tool approvals still apply. */
  startRun(action: ProactiveAction, goal: Goal): Promise<string | null>;
  notify(message: { kind: "digest" | "approval"; digest: ProactiveDigest }): Promise<void>;
}

export type CycleReport = {
  started: ProactiveAction[];
  waiting: ProactiveAction[];
  digestSent: boolean;
};

const DEADLINE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/** Deadlines inside three days wake their goal, once a day. */
export function deadlineEvents(goals: readonly Goal[], at: Date): ProactiveEvent[] {
  return goals.flatMap((goal) => {
    if (goal.status !== "active" || !goal.deadline) return [];
    const left = new Date(goal.deadline).getTime() - at.getTime();
    return left > 0 && left <= DEADLINE_SOON_MS
      ? [{ trigger: "deadline_near" as const, goalId: goal.id, summary: "deadline soon" }]
      : [];
  });
}

/**
 * One pass: choose the goals that are due (or woken by an event), plan their next steps, start
 * the safe ones as bot runs and hold the risky ones for the person, then send the day's digest
 * when it is time and the person may be pinged.
 */
export async function runProactiveCycle(
  ports: ProactivePorts,
  events: readonly ProactiveEvent[] = [],
): Promise<CycleReport> {
  const at = ports.now();
  const nowIso = at.toISOString();
  const goals = await ports.loadGoals();
  const state = await ports.loadState();
  const allEvents = [...events, ...deadlineEvents(goals, at)];
  const report: CycleReport = { started: [], waiting: [], digestSent: false };
  let budgetLeft = state.settings.hoursBudgetPerDay * 60 - minutesUsedOnDay(state, at);
  for (const slot of goalsDue(goals, state, at, allEvents)) {
    const taste = goalTaste(state, slot.goal.id);
    const recent = state.actions
      .filter((action) => action.goalId === slot.goal.id)
      .slice(-5)
      .map((action) => action.title);
    const event = allEvents.find((candidate) => candidate.trigger === slot.trigger);
    const planned = await ports.plan({
      goal: slot.goal,
      trigger: slot.trigger,
      ...(event && slot.trigger !== "schedule" ? { event: event.summary } : {}),
      room: slot.room,
      ...taste,
      recent,
    });
    for (const step of planned.slice(0, slot.room)) {
      if (!step.title.trim() || step.minutes > budgetLeft) continue;
      budgetLeft -= step.minutes;
      const risk = proactiveRisk(step);
      const action: ProactiveAction = {
        id: ports.newId(),
        // Every action carries the goal it serves; there is no other way to create one.
        goalId: slot.goal.id,
        kind: step.kind,
        title: step.title.trim().slice(0, 200),
        instructions: step.instructions.slice(0, 2000),
        trigger: slot.trigger,
        status: risk ? "needs_approval" : "queued",
        ...(risk ? { risk } : {}),
        minutes: step.minutes,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await ports.updateState((current) =>
        trimProactiveState({ ...current, actions: [...current.actions, action] }),
      );
      if (risk) {
        report.waiting.push(action);
        continue;
      }
      const runId = await ports.startRun(action, slot.goal);
      const started = await setAction(ports, action.id, (current) => ({
        ...current,
        ...(runId ? { runId } : { status: "failed" as const }),
      }));
      if (started) report.started.push(started);
    }
  }
  report.digestSent = await maybeSendDigest(ports, report.waiting.length > 0);
  return report;
}

async function setAction(
  ports: ProactivePorts,
  id: string,
  change: (action: ProactiveAction) => ProactiveAction,
): Promise<ProactiveAction | undefined> {
  let updated: ProactiveAction | undefined;
  await ports.updateState((current) => ({
    ...current,
    actions: current.actions.map((action) => {
      if (action.id !== id) return action;
      updated = { ...change(action), updatedAt: ports.now().toISOString() };
      return updated;
    }),
  }));
  return updated;
}

/**
 * The digest goes out once a day after the digest hour; work waiting for the person may ping
 * sooner. Neither ever goes out in quiet hours or past the day's limit: it waits for later.
 */
async function maybeSendDigest(ports: ProactivePorts, approvalWaiting: boolean): Promise<boolean> {
  const at = ports.now();
  const state = await ports.loadState();
  const { day, hour } = localClock(at, state.settings.timeZone);
  if (!mayNotify(state, at)) return false;
  const digestDue = hour >= state.settings.digestHour && state.lastDigestDay !== day;
  if (!digestDue && !approvalWaiting) return false;
  const digest = buildDigest(state, at);
  if (digestDue && digest.items.length === 0 && digest.waiting.length === 0) {
    // Nothing to say: mark the day so an empty digest never pings.
    await ports.updateState((current) => ({ ...current, lastDigestDay: day }));
    return false;
  }
  const kind = digestDue ? "digest" : "approval";
  await ports.notify({ kind, digest });
  await ports.updateState((current) =>
    trimProactiveState({
      ...current,
      notifications: [...current.notifications, { at: at.toISOString(), kind }],
      ...(digestDue ? { lastDigestDay: day } : {}),
    }),
  );
  return true;
}

export class ProactiveActionNotFoundError extends ClientError {
  constructor() {
    super("NOT_FOUND", "That's no longer here.", "proactive_action_not_found");
    this.name = "ProactiveActionNotFoundError";
  }
}

function findAction(state: ProactiveState, id: string): ProactiveAction {
  const action = state.actions.find((candidate) => candidate.id === id);
  if (!action) throw new ProactiveActionNotFoundError();
  return action;
}

/** A finished run's outcome, matched to its action by run id. */
export function recordRunOutcome(
  state: ProactiveState,
  runId: string,
  outcome: { ok: boolean; result?: string },
  now: string,
): ProactiveState {
  return {
    ...state,
    actions: state.actions.map((action) =>
      action.runId === runId && action.status === "queued"
        ? {
            ...action,
            status: outcome.ok ? "done" : "failed",
            ...(outcome.result ? { result: outcome.result.slice(0, 1000) } : {}),
            updatedAt: now,
          }
        : action,
    ),
  };
}

/** The person's answer to finished work: it tunes how much Gente does for that goal. */
export function decideAction(
  state: ProactiveState,
  id: string,
  verdict: ProactiveVerdict,
  now: string,
): ProactiveState {
  findAction(state, id);
  return {
    ...state,
    actions: state.actions.map((action) =>
      action.id === id ? { ...action, verdict, updatedAt: now } : action,
    ),
  };
}

/**
 * The person approves or skips work that waits for them. Approving starts it as a normal run, and
 * that run still asks again at the moment it would pay, send, delete or agree.
 */
export async function approveAction(
  ports: ProactivePorts,
  id: string,
  approve: boolean,
): Promise<ProactiveAction> {
  const state = await ports.loadState();
  const action = findAction(state, id);
  if (action.status !== "needs_approval") return action;
  if (!approve)
    return (await setAction(ports, id, (current) => ({ ...current, status: "skipped" })))!;
  const goal = (await ports.loadGoals()).find((candidate) => candidate.id === action.goalId);
  if (!goal || goal.status !== "active")
    return (await setAction(ports, id, (current) => ({ ...current, status: "skipped" })))!;
  const runId = await ports.startRun(action, goal);
  return (await setAction(ports, id, (current) => ({
    ...current,
    status: runId ? "queued" : "failed",
    ...(runId ? { runId } : {}),
  })))!;
}

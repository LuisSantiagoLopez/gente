// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type {
  Goal,
  GoalMetrics,
  ProactiveAction,
  ProactiveDigest,
  ProactiveMetrics,
  ProactiveState,
  ProactiveVerdict,
} from "@rakazo/contracts";
import { digestHeadline } from "./proactive.prompt.js";
import { actionsOnDay, effectiveDial, localClock } from "./proactive-policy.js";

/** Today's digest: what Gente finished, and what waits for the person. */
export function buildDigest(state: ProactiveState, at: Date): ProactiveDigest {
  const today = actionsOnDay(state, at);
  const items = today.filter((action) => action.status === "done");
  const waiting = state.actions.filter((action) => action.status === "needs_approval");
  return {
    day: localClock(at, state.settings.timeZone).day,
    headline: digestHeadline(items.length),
    items,
    waiting,
  };
}

/** The digest as one chat message, for a messaging app. */
export function digestText(digest: ProactiveDigest, goals: readonly Goal[]): string {
  const goalTitle = (id: string) => goals.find((goal) => goal.id === id)?.title ?? "";
  const lines = [`${digest.headline}:`];
  for (const item of digest.items) {
    const goal = goalTitle(item.goalId);
    lines.push(
      `• ${item.title}${goal ? ` (${goal})` : ""}${item.result ? `: ${item.result}` : ""}`,
    );
  }
  if (digest.waiting.length)
    lines.push(
      digest.waiting.length === 1
        ? "1 thing waits for your OK."
        : `${digest.waiting.length} things wait for your OK.`,
    );
  lines.push("Open Your AI, Goals, to undo anything.");
  return lines.join("\n");
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
}

function tally(actions: readonly ProactiveAction[]) {
  const count = (verdict: ProactiveVerdict) =>
    actions.filter((action) => action.verdict === verdict).length;
  const accepted = count("accepted");
  const rejected = count("rejected");
  const undone = count("undone");
  const decided = accepted + rejected + undone;
  const done = actions.filter((action) => action.status === "done").length;
  return {
    accepted,
    rejected,
    undone,
    decided,
    acceptanceRate: rate(accepted, decided),
    undoRate: rate(undone, done),
  };
}

/** Acceptance rate (accepted of decided), undo rate (undone of done), and progress per goal. */
export function proactiveMetrics(state: ProactiveState, goals: readonly Goal[]): ProactiveMetrics {
  const all = tally(state.actions);
  const perGoal: GoalMetrics[] = goals.map((goal) => {
    const actions = state.actions.filter((action) => action.goalId === goal.id);
    const t = tally(actions);
    return {
      goalId: goal.id,
      title: goal.title,
      actions: actions.length,
      accepted: t.accepted,
      rejected: t.rejected,
      undone: t.undone,
      acceptanceRate: t.acceptanceRate,
      undoRate: t.undoRate,
      progress: goal.progress,
      dial: goal.dial,
      effectiveDial: effectiveDial(goal, state),
    };
  });
  return {
    actions: state.actions.length,
    decided: all.decided,
    acceptanceRate: all.acceptanceRate,
    undoRate: all.undoRate,
    goals: perGoal,
  };
}

/** What the person accepted and rejected for a goal, for the planner to lean toward or away from. */
export function goalTaste(state: ProactiveState, goalId: string, limit = 5) {
  const mine = state.actions.filter((action) => action.goalId === goalId);
  const pick = (verdicts: ProactiveVerdict[]) =>
    mine
      .filter((action) => action.verdict && verdicts.includes(action.verdict))
      .slice(-limit)
      .map((action) => action.title);
  return { accepted: pick(["accepted"]), rejected: pick(["rejected", "undone"]) };
}

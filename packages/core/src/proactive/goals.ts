// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Goal, GoalSource, GoalStatus, ProactiveDial } from "@rakazo/contracts";
import { GoalSchema } from "@rakazo/contracts";

export const GOAL_PATH_PREFIX = "goals/";
export const MAX_GOALS = 30;

export function goalPath(id: string): string {
  return `${GOAL_PATH_PREFIX}${id}.json`;
}

export function newGoal(input: {
  id: string;
  title: string;
  outcome?: string;
  source: GoalSource;
  dial?: ProactiveDial;
  deadline?: string;
  projectId?: string;
  now: string;
}): Goal {
  return {
    id: input.id,
    title: input.title.trim().slice(0, 200),
    outcome: (input.outcome ?? "").trim().slice(0, 500),
    status: "active",
    // Normal unless the person picks otherwise.
    dial: input.dial ?? "normal",
    source: input.source,
    progress: 0,
    ...(input.deadline ? { deadline: input.deadline } : {}),
    projectIds: input.projectId ? [input.projectId] : [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** A stored goal, or null when the document no longer has a goal's shape. */
export function parseGoal(content: string): Goal | null {
  try {
    const parsed = GoalSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeGoal(goal: Goal): string {
  return `${JSON.stringify(goal, null, 2)}\n`;
}

export type GoalChange = {
  title?: string;
  outcome?: string;
  status?: GoalStatus;
  dial?: ProactiveDial;
  progress?: number;
  /** null clears it. */
  deadline?: string | null;
  linkProjectId?: string;
};

/** The goal with the change applied, or the same object when nothing changed. */
export function applyGoalChange(goal: Goal, change: GoalChange, now: string): Goal {
  const next: Goal = { ...goal };
  if (change.title?.trim()) next.title = change.title.trim().slice(0, 200);
  if (change.outcome !== undefined) next.outcome = change.outcome.trim().slice(0, 500);
  if (change.status) next.status = change.status;
  if (change.dial) next.dial = change.dial;
  if (change.progress !== undefined)
    next.progress = Math.max(0, Math.min(100, Math.round(change.progress)));
  if (change.deadline === null) delete next.deadline;
  else if (change.deadline) next.deadline = change.deadline;
  if (change.linkProjectId && !next.projectIds.includes(change.linkProjectId))
    next.projectIds = [...next.projectIds, change.linkProjectId].slice(-20);
  if (JSON.stringify(next) === JSON.stringify(goal)) return goal;
  return { ...next, updatedAt: now };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
}

/**
 * An existing goal that says the same thing, so a goal heard again in chat updates instead of
 * piling up duplicates. Most of the shorter title's words must appear in the other.
 */
export function findSimilarGoal(goals: readonly Goal[], title: string): Goal | undefined {
  const wanted = words(title);
  if (wanted.size === 0) return undefined;
  return goals.find((goal) => {
    const have = words(goal.title);
    const [small, large] = have.size < wanted.size ? [have, wanted] : [wanted, have];
    if (small.size === 0) return false;
    let shared = 0;
    for (const word of small) if (large.has(word)) shared += 1;
    return shared / small.size >= 0.75;
  });
}

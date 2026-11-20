// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Goal } from "@rakazo/contracts";
import { GoalStatusSchema, ProactiveDialSchema } from "@rakazo/contracts";
import type { GoalChange } from "@rakazo/core";
import { findSimilarGoal, newGoal } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import type { KnowledgeOwner } from "../knowledge/knowledge-store.js";
import { createGoalDocument, listGoals, newGoalId, updateGoal } from "./proactive-store.js";

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** The change a goal_update call asks for, or an error the model can fix and retry. */
export function goalChangeFromArgs(args: Record<string, unknown>): GoalChange | { error: string } {
  const change: GoalChange = {};
  if (args.status !== undefined) {
    const status = GoalStatusSchema.safeParse(args.status);
    if (!status.success) return { error: "status must be active, paused or done." };
    change.status = status.data;
  }
  if (args.dial !== undefined) {
    const dial = ProactiveDialSchema.safeParse(args.dial);
    if (!dial.success) return { error: "dial must be quiet, normal or go_hard." };
    change.dial = dial.data;
  }
  if (args.progress !== undefined) {
    if (typeof args.progress !== "number" || !Number.isFinite(args.progress))
      return { error: "progress must be a number from 0 to 100." };
    change.progress = args.progress;
  }
  const outcome = text(args.outcome, 500);
  if (outcome) change.outcome = outcome;
  const projectId = text(args.projectId, 40);
  if (projectId) change.linkProjectId = projectId;
  return change;
}

function summary(goal: Goal) {
  return {
    goalId: goal.id,
    title: goal.title,
    status: goal.status,
    progress: goal.progress,
    dial: goal.dial,
  };
}

/**
 * goal_update: the bot records a goal the person states, or moves one forward, without asking.
 * It acts only on the run owner's goals in the run's Space. A goal said again in other words
 * updates the one already there instead of adding a copy.
 */
export async function runGoalUpdate(
  deps: { prisma: PrismaClient; events?: Pick<ThreadEvents, "publishSpaceChange"> },
  input: { owner: KnowledgeOwner; runId: string; args: Record<string, unknown> },
): Promise<unknown> {
  const change = goalChangeFromArgs(input.args);
  if ("error" in change) return { error: change.error };
  const goals = await listGoals(deps.prisma, input.owner);
  const goalId = text(input.args.goalId, 40);
  const title = text(input.args.title, 200);
  let target = goalId ? goals.find((goal) => goal.id === goalId) : undefined;
  if (goalId && !target) return { error: `No goal ${goalId}. Give title to add a new one.` };
  target ??= title ? findSimilarGoal(goals, title) : undefined;
  if (!target) {
    if (!title) return { error: "Give title to add a goal, or goalId to change one." };
    const created = await createGoalDocument(
      deps.prisma,
      input.owner,
      newGoal({
        id: newGoalId(),
        title,
        source: "chat",
        now: new Date().toISOString(),
        ...(change.outcome ? { outcome: change.outcome } : {}),
        ...(change.dial ? { dial: change.dial } : {}),
        ...(change.linkProjectId ? { projectId: change.linkProjectId } : {}),
      }),
      { sourceRunId: input.runId },
    );
    await deps.events?.publishSpaceChange?.(input.owner.spaceId, "knowledge");
    return { added: true, ...summary(created) };
  }
  const updated = await updateGoal(deps.prisma, input.owner, target.id, change, {
    sourceRunId: input.runId,
  });
  await deps.events?.publishSpaceChange?.(input.owner.spaceId, "knowledge");
  return summary(updated);
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { randomUUID } from "node:crypto";
import type { Goal, ProactiveState } from "@rakazo/contracts";
import { GOAL_MEMORY_SCOPE, PROACTIVE_MEMORY_SCOPE, ProactiveStateSchema } from "@rakazo/contracts";
import type { GoalChange } from "@rakazo/core";
import {
  applyGoalChange,
  ClientError,
  emptyProactiveState,
  GOAL_PATH_PREFIX,
  goalPath,
  MAX_GOALS,
  parseGoal,
  retry,
  serializeGoal,
  trimProactiveState,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import type { KnowledgeOwner } from "../knowledge/knowledge-store.js";
import { KnowledgeConflictError, saveDocument } from "../knowledge/knowledge-store.js";

/**
 * Goals and the proactive log are Space memory documents under their own scopes, like brains and
 * projects: encrypted, every save kept as a revision, and only on this computer.
 */
export const PROACTIVE_STATE_PATH = "proactive/state.json";

export function newGoalId(): string {
  return `g${randomUUID().replace(/-/g, "").slice(0, 11)}`;
}

export function newProactiveActionId(): string {
  return `x${randomUUID().replace(/-/g, "").slice(0, 11)}`;
}

export async function listGoals(prisma: PrismaClient, owner: KnowledgeOwner): Promise<Goal[]> {
  const rows = await prisma.memoryDocument.findMany({
    where: {
      spaceId: owner.spaceId,
      scope: GOAL_MEMORY_SCOPE,
      botId: null,
      path: { startsWith: GOAL_PATH_PREFIX },
    },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });
  return rows.flatMap((row) => parseGoal(row.content) ?? []);
}

export class GoalNotFoundError extends ClientError {
  constructor() {
    super("NOT_FOUND", "That goal is no longer here.", "goal_not_found");
    this.name = "GoalNotFoundError";
  }
}

export async function createGoalDocument(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  goal: Goal,
  options: { sourceRunId?: string } = {},
): Promise<Goal> {
  if ((await listGoals(prisma, owner)).length >= MAX_GOALS)
    throw new ClientError(
      "BAD_REQUEST",
      `You can keep up to ${MAX_GOALS} goals. Finish or remove one first.`,
      "goal_limit",
    );
  await saveDocument(prisma, owner, {
    scope: GOAL_MEMORY_SCOPE,
    path: goalPath(goal.id),
    content: serializeGoal(goal),
    expectedRevision: 0,
    ...options,
  });
  return goal;
}

/** Reads, changes and saves a goal as one step, reapplying the change after a lost race. */
export async function updateGoal(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
  change: GoalChange,
  options: { sourceRunId?: string } = {},
): Promise<Goal> {
  return retry(
    async () => {
      const row = await prisma.memoryDocument.findFirst({
        where: {
          spaceId: owner.spaceId,
          scope: GOAL_MEMORY_SCOPE,
          botId: null,
          path: goalPath(id),
        },
        select: { content: true, revision: true },
      });
      const goal = row ? parseGoal(row.content) : null;
      if (!row || !goal) throw new GoalNotFoundError();
      const next = applyGoalChange(goal, change, new Date().toISOString());
      if (next === goal) return goal;
      await saveDocument(prisma, owner, {
        scope: GOAL_MEMORY_SCOPE,
        path: goalPath(id),
        content: serializeGoal(next),
        expectedRevision: row.revision,
        ...options,
      });
      return next;
    },
    { attempts: 5, delayMs: 0, retryable: (error) => error instanceof KnowledgeConflictError },
  );
}

export async function removeGoal(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
): Promise<void> {
  // Revisions cascade with the document.
  await prisma.memoryDocument.deleteMany({
    where: { spaceId: owner.spaceId, scope: GOAL_MEMORY_SCOPE, botId: null, path: goalPath(id) },
  });
}

function parseState(content: string): ProactiveState | null {
  try {
    const parsed = ProactiveStateSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readStateRow(prisma: PrismaClient, owner: KnowledgeOwner) {
  return prisma.memoryDocument.findFirst({
    where: {
      spaceId: owner.spaceId,
      scope: PROACTIVE_MEMORY_SCOPE,
      botId: null,
      path: PROACTIVE_STATE_PATH,
    },
    select: { content: true, revision: true },
  });
}

/** The proactive log and settings; a missing or unreadable one starts fresh with the defaults. */
export async function loadProactiveState(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  defaults: { timeZone?: string } = {},
): Promise<ProactiveState> {
  const row = await readStateRow(prisma, owner);
  return (
    (row ? parseState(row.content) : null) ??
    emptyProactiveState(defaults.timeZone ? { timeZone: defaults.timeZone } : {})
  );
}

export async function updateProactiveState(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  change: (state: ProactiveState) => ProactiveState,
  defaults: { timeZone?: string } = {},
): Promise<ProactiveState> {
  return retry(
    async () => {
      const row = await readStateRow(prisma, owner);
      const current =
        (row ? parseState(row.content) : null) ??
        emptyProactiveState(defaults.timeZone ? { timeZone: defaults.timeZone } : {});
      const next = trimProactiveState(change(current));
      if (row && next === current) return current;
      await saveDocument(prisma, owner, {
        scope: PROACTIVE_MEMORY_SCOPE,
        path: PROACTIVE_STATE_PATH,
        content: `${JSON.stringify(next)}\n`,
        expectedRevision: row?.revision ?? 0,
      });
      return next;
    },
    { attempts: 5, delayMs: 0, retryable: (error) => error instanceof KnowledgeConflictError },
  );
}

/** The people who have at least one goal in a Space: the only ones the engine works for. */
export async function ownersWithGoals(prisma: PrismaClient): Promise<KnowledgeOwner[]> {
  const rows = await prisma.memoryDocument.findMany({
    where: { scope: GOAL_MEMORY_SCOPE, botId: null, space: { deletingAt: null } },
    distinct: ["spaceId", "userId"],
    select: { spaceId: true, userId: true },
  });
  return rows;
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { AgentRunRequest, AgentRuntime, JobPublisher } from "@rakazo/adapter-kit";
import type { Goal, ProactiveDigest, ProactiveState } from "@rakazo/contracts";
import { GoalExtractOutputSchema, ProactivePlanOutputSchema } from "@rakazo/contracts";
import type { PlannedAction, ProactiveEvent, ProactivePorts } from "@rakazo/core";
import {
  ACTIVE_RUN_STATUSES,
  blocksToAgentHistoryText,
  digestText,
  findSimilarGoal,
  goalExtractInstructions,
  goalExtractPrompt,
  newGoal,
  proactivePlannerInstructions,
  proactivePlannerPrompt,
  proactiveRunPrompt,
  recordRunOutcome,
  runProactiveCycle,
} from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { isUniqueViolation, recordUsage, storedMessageBlocks } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { KnowledgeOwner } from "../knowledge/knowledge-store.js";
import { listProjects } from "../knowledge/knowledge-store.js";
import type { MessagingDelivery } from "../messaging/messaging-delivery.js";
import { resolveDeploymentModel } from "../models/deployment-model.js";
import { postRoutineWatchMessage } from "../routines/routine-watch.js";
import { wakeRun } from "../runs/wakeups/wake-run.js";
import {
  createGoalDocument,
  listGoals,
  loadProactiveState,
  newGoalId,
  newProactiveActionId,
  updateProactiveState,
} from "./proactive-store.js";

/** Runs the engine starts carry this nonce prefix, so their end is matched to their action. */
export const PROACTIVE_NONCE_PREFIX = "gente-proactive";

export function isProactiveRun(run: { trigger: string; clientNonce?: string | null }): boolean {
  return (
    run.trigger === "routine" && Boolean(run.clientNonce?.startsWith(`${PROACTIVE_NONCE_PREFIX}:`))
  );
}

export interface ProactiveDeps {
  prisma: PrismaClient;
  /** Absent where only finished work is approved or undone, never planned. */
  runtime?: AgentRuntime;
  jobs: JobPublisher;
  events?: Pick<ThreadEvents, "publishSpaceChange" | "notify">;
  messagingDelivery?: Pick<MessagingDelivery, "record">;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
  resolveModel?: (scope: {
    userId: string;
    spaceId: string;
    botId?: string;
  }) => Promise<AgentRunRequest["model"]>;
  now?: () => Date;
}

const MODEL_TIMEOUT_MS = 4 * 60_000;
const STALLED_PROJECT_MS = 3 * 24 * 60 * 60 * 1000;
/** Only messages that sound like the person wants something reach the goal finder. */
const SOUNDS_LIKE_A_GOAL =
  /\b(i want to|i'd like to|my goal|i'm trying to|i am trying to|i need to|i hope to|help me (?:to )?(?:grow|land|ship|launch|get|find|build|sell)|quiero|mi meta|mi objetivo|necesito)\b/i;

/** The owner's working bot and its chat: the project's chat when the goal has one. */
async function workingThread(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  threadIds: readonly string[] = [],
): Promise<{ botId: string; threadId: string } | null> {
  const thread = await prisma.thread.findFirst({
    where: {
      spaceId: owner.spaceId,
      userId: owner.userId,
      botId: { not: null },
      groupId: null,
      bot: { archivedAt: null },
      ...(threadIds.length ? { id: { in: [...threadIds] } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, botId: true },
  });
  if (thread?.botId) return { botId: thread.botId, threadId: thread.id };
  return threadIds.length ? workingThread(prisma, owner) : null;
}

async function engineModel(deps: ProactiveDeps, owner: KnowledgeOwner, botId: string) {
  if (deps.resolveModel) return deps.resolveModel({ ...owner, botId });
  if (deps.deploymentModelConfigured) {
    const fallback = resolveDeploymentModel();
    return { provider: fallback.provider, id: fallback.model, apiKey: deps.deploymentModelKey };
  }
  const settings = await deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } });
  return {
    provider: settings?.defaultModelProvider ?? "scripted",
    id: settings?.defaultModelId ?? "scripted",
    apiKey: undefined,
  };
}

/** One model call with no tools; null when no usable model is set up. A failed call throws. */
async function askModel(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  where: { botId: string; threadId: string },
  input: { operationId: string; instructions: string; prompt: string },
): Promise<string | null> {
  const runtime = deps.runtime;
  if (!runtime) return null;
  const model = await engineModel(deps, owner, where.botId);
  if (model.provider === "scripted") return null;
  let answer = "";
  for await (const event of runtime.run(
    {
      botId: where.botId,
      threadId: where.threadId,
      runId: input.operationId,
      usageOperationKind: "compaction",
      onUsage: async (usage) => {
        await recordUsage(deps.prisma, usage, {
          ...owner,
          botId: where.botId,
          operationId: input.operationId,
          operationKind: "compaction",
        });
      },
      prompt: input.prompt,
      instructions: input.instructions,
      history: [],
      tools: [],
      model,
      allowSilentEmpty: true,
    },
    {
      operationId: input.operationId,
      traceId: input.operationId,
      ...owner,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    },
  )) {
    if (event.type === "usage" && !event.accounted) {
      await recordUsage(deps.prisma, event, {
        ...owner,
        botId: where.botId,
        operationId: input.operationId,
        operationKind: "compaction",
      });
    }
    if (event.type === "done" && event.text) answer = event.text;
  }
  if (/^(?:I hit a problem:|Unknown model )/i.test(answer.trim()))
    throw new Error("proactive model call failed");
  return answer;
}

function jsonIn(answer: string): unknown {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The planner's answer as actions; anything unreadable plans nothing. */
export function parsePlannedActions(answer: string): PlannedAction[] {
  const parsed = ProactivePlanOutputSchema.safeParse(jsonIn(answer));
  return parsed.success ? parsed.data.actions : [];
}

/** The goal finder's answer; anything unreadable finds nothing. */
export function parseExtractedGoals(answer: string) {
  const parsed = GoalExtractOutputSchema.safeParse(jsonIn(answer));
  return parsed.success ? parsed.data.goals : [];
}

/**
 * Goals Gente learns without being told through the tool: each active project's own goals, and
 * goals the person stated in their chats since the last look (a cheap word check first, so the
 * model reads only messages that sound like one).
 */
export async function learnGoals(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  since: Date | null,
): Promise<Goal[]> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  let goals = await listGoals(deps.prisma, owner);
  const added: Goal[] = [];
  const add = async (goal: Goal) => {
    if (findSimilarGoal(goals, goal.title)) return;
    await createGoalDocument(deps.prisma, owner, goal);
    goals = [...goals, goal];
    added.push(goal);
  };
  for (const project of await listProjects(deps.prisma, owner)) {
    if (project.status !== "active") continue;
    if (goals.some((goal) => goal.projectIds.includes(project.id))) continue;
    const title = project.goals[0] ?? project.name;
    await add(newGoal({ id: newGoalId(), title, source: "project", projectId: project.id, now }));
  }
  const messages = await deps.prisma.message.findMany({
    where: {
      role: "user",
      authorUserId: owner.userId,
      thread: { spaceId: owner.spaceId, userId: owner.userId, groupId: null },
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, blocks: true, threadId: true },
  });
  const said = messages
    .map((message) => blocksToAgentHistoryText(storedMessageBlocks(message)))
    .filter((text) => SOUNDS_LIKE_A_GOAL.test(text))
    .slice(0, 8);
  if (said.length === 0) return added;
  const where = await workingThread(deps.prisma, owner);
  if (!where) return added;
  const answer = await askModel(deps, owner, where, {
    operationId: `goal-extract:${owner.userId}:${now}`,
    instructions: goalExtractInstructions(),
    prompt: goalExtractPrompt(said.reverse().join("\n\n")),
  });
  for (const found of answer ? parseExtractedGoals(answer) : []) {
    await add(
      newGoal({ id: newGoalId(), title: found.title, outcome: found.outcome, source: "chat", now }),
    );
  }
  return added;
}

/** Queued actions whose run ended without a reply the completion hook saw: failed or cancelled. */
async function settleEndedRuns(deps: ProactiveDeps, owner: KnowledgeOwner, state: ProactiveState) {
  const open = state.actions.filter((action) => action.status === "queued" && action.runId);
  if (open.length === 0) return;
  const runs = await deps.prisma.run.findMany({
    where: { id: { in: open.map((action) => action.runId!) }, spaceId: owner.spaceId },
    select: { id: true, status: true },
  });
  const ended = runs.filter(
    (run) => !(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status),
  );
  const missing = open.filter((action) => !runs.some((run) => run.id === action.runId));
  if (ended.length === 0 && missing.length === 0) return;
  const now = new Date().toISOString();
  await updateProactiveState(deps.prisma, owner, (current) => {
    let next = current;
    for (const run of ended)
      next = recordRunOutcome(next, run.id, { ok: run.status === "completed" }, now);
    for (const action of missing) next = recordRunOutcome(next, action.runId!, { ok: false }, now);
    return next;
  });
}

/** Projects linked to a goal with nothing new for three days wake that goal. */
async function stalledProjectEvents(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  goals: readonly Goal[],
  at: Date,
): Promise<ProactiveEvent[]> {
  const projects = await listProjects(deps.prisma, owner);
  return goals.flatMap((goal) => {
    const stalled = projects.find(
      (project) =>
        goal.projectIds.includes(project.id) &&
        project.status === "active" &&
        at.getTime() - new Date(project.updatedAt).getTime() > STALLED_PROJECT_MS,
    );
    return stalled
      ? [
          {
            trigger: "project_stalled" as const,
            goalId: goal.id,
            summary: `${stalled.name} has not moved in 3 days`,
          },
        ]
      : [];
  });
}

async function startProactiveRun(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  action: { id: string; title: string },
  goal: Goal,
  prompt: string,
): Promise<string | null> {
  const projects = (await listProjects(deps.prisma, owner)).filter((project) =>
    goal.projectIds.includes(project.id),
  );
  const where = await workingThread(
    deps.prisma,
    owner,
    projects.flatMap((project) => project.threadIds),
  );
  if (!where) return null;
  try {
    const runId = await deps.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: { ...owner, botId: where.botId, threadId: where.threadId, prompt, status: "queued" },
      });
      const run = await tx.run.create({
        data: {
          ...owner,
          botId: where.botId,
          threadId: where.threadId,
          taskId: task.id,
          status: "queued",
          // A routine-trigger turn: it runs with the bot's own tools and approval rules, and it
          // may end quietly when there is nothing worth saying.
          trigger: "routine",
          clientNonce: `${PROACTIVE_NONCE_PREFIX}:${action.id}`,
        },
        select: { id: true },
      });
      return run.id;
    });
    await wakeRun(deps.jobs, runId);
    return runId;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** The digest in the app (a line in the bot's chat) and in the person's messaging app. */
async function deliverDigest(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  message: { kind: "digest" | "approval"; digest: ProactiveDigest },
  goals: readonly Goal[],
) {
  const text = digestText(message.digest, goals);
  await deps.events?.publishSpaceChange?.(owner.spaceId, "knowledge");
  const where = await workingThread(deps.prisma, owner);
  if (where && deps.events?.notify) {
    await postRoutineWatchMessage(
      { prisma: deps.prisma, events: deps.events as ThreadEvents },
      { spaceId: owner.spaceId, threadId: where.threadId, botId: where.botId, role: "bot", text },
    );
  }
  if (!deps.messagingDelivery) return;
  const identity = await deps.prisma.messagingIdentity.findFirst({
    where: { ...owner, verifiedAt: { not: null } },
    orderBy: { lastInboundAt: "desc" },
    select: { id: true },
  });
  if (!identity) return;
  await deps.messagingDelivery.record({ identityId: identity.id }, [
    {
      idempotencyKey: `proactive:${owner.spaceId}:${owner.userId}:${message.kind}:${message.digest.day}:${message.digest.items.length}:${message.digest.waiting.length}`,
      kind: "dm",
      identityId: identity.id,
      body: text,
    },
  ]);
}

/** The engine's ports for one person, on the database, their model and their bot's runs. */
export function proactivePorts(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  timeZone: string,
): ProactivePorts {
  const defaults = { timeZone };
  let goals: Goal[] | null = null;
  return {
    now: () => deps.now?.() ?? new Date(),
    newId: newProactiveActionId,
    loadGoals: async () => (goals ??= await listGoals(deps.prisma, owner)),
    loadState: () => loadProactiveState(deps.prisma, owner, defaults),
    updateState: (change) => updateProactiveState(deps.prisma, owner, change, defaults),
    plan: async (input) => {
      const where = await workingThread(deps.prisma, owner);
      if (!where) return [];
      const answer = await askModel(deps, owner, where, {
        operationId: `proactive-plan:${input.goal.id}:${Date.now()}`,
        instructions: proactivePlannerInstructions(),
        prompt: proactivePlannerPrompt(input),
      });
      return answer ? parsePlannedActions(answer) : [];
    },
    startRun: (action, goal) =>
      startProactiveRun(deps, owner, action, goal, proactiveRunPrompt(action, goal)),
    notify: async (message) => deliverDigest(deps, owner, message, goals ?? []),
  };
}

/**
 * One proactive pass for one person: settle ended runs, learn new goals, then let the engine
 * plan, act and report. Never runs for someone without a goal.
 */
export async function runProactiveForOwner(
  deps: ProactiveDeps,
  owner: KnowledgeOwner,
  events: readonly ProactiveEvent[] = [],
) {
  const user = await deps.prisma.user.findUnique({
    where: { id: owner.userId },
    select: { timezone: true },
  });
  const timeZone = user?.timezone ?? "UTC";
  const at = deps.now?.() ?? new Date();
  const state = await loadProactiveState(deps.prisma, owner, { timeZone });
  if (!state.settings.enabled) return null;
  await settleEndedRuns(deps, owner, state);
  await learnGoals(deps, owner, state.goalScanAt ? new Date(state.goalScanAt) : null).catch(
    (error) => getLogger().error("proactive goal learning", error),
  );
  await updateProactiveState(
    deps.prisma,
    owner,
    (current) => ({ ...current, goalScanAt: at.toISOString() }),
    { timeZone },
  );
  const goals = await listGoals(deps.prisma, owner);
  if (!goals.some((goal) => goal.status === "active")) return null;
  const stalled = await stalledProjectEvents(deps, owner, goals, at);
  return runProactiveCycle(proactivePorts(deps, owner, timeZone), [...events, ...stalled]);
}

/** A proactive run ended: its reply becomes the action's result. */
export async function recordProactiveRunResult(
  deps: Pick<ProactiveDeps, "prisma" | "events">,
  input: { spaceId: string; userId: string; runId: string; ok: boolean; summary: string },
) {
  const owner = { spaceId: input.spaceId, userId: input.userId };
  const now = new Date().toISOString();
  await updateProactiveState(deps.prisma, owner, (current) =>
    recordRunOutcome(
      current,
      input.runId,
      { ok: input.ok, result: input.summary.trim().slice(0, 1000) },
      now,
    ),
  );
  await deps.events?.publishSpaceChange?.(input.spaceId, "knowledge");
}

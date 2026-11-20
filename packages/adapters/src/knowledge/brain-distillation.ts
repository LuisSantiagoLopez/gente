// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { AgentRunRequest, AgentRuntime, BackgroundJobPayloads } from "@rakazo/adapter-kit";
import type { BrainCitation, ToolHistory } from "@rakazo/contracts";
import { ToolHistorySchema } from "@rakazo/contracts";
import type { DistillSource } from "@rakazo/core";
import {
  applyProjectChange,
  blocksToAgentHistoryText,
  brainDistillInstructions,
  brainDistillPrompt,
  brainSlug,
  matchBrains,
  mergeBrain,
  parseBrainDistillation,
} from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { recordUsage, storedMessageBlocks } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { resolveDeploymentModel } from "../models/deployment-model.js";
import type { KnowledgeOwner } from "./knowledge-store.js";
import { listBrains, readProject, saveBrain, updateProject } from "./knowledge-store.js";

/** Tools whose results are outside research worth keeping. */
export const RESEARCH_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
  "browser_navigate",
  "browser_snapshot",
  "page_browser",
  "read_email",
]);

export const DISTILL_TIMEOUT_MS = 4 * 60_000;
const MAX_SOURCES = 12;

export interface BrainDistillDeps {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  events?: Pick<ThreadEvents, "publishSpaceChange">;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
  resolveModel?: (scope: {
    userId: string;
    spaceId: string;
    botId?: string;
  }) => Promise<AgentRunRequest["model"]>;
}

function parseToolHistory(stored: string | null | undefined): ToolHistory | null {
  if (!stored) return null;
  try {
    const parsed = ToolHistorySchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function urlFromArguments(json: string | undefined): string | null {
  if (!json) return null;
  try {
    const args = JSON.parse(json) as Record<string, unknown>;
    const url = typeof args.url === "string" ? args.url : null;
    return url && /^https?:\/\//i.test(url) && url.length <= 2000 ? url : null;
  } catch {
    return null;
  }
}

function queryFromArguments(json: string | undefined): string | null {
  if (!json) return null;
  try {
    const args = JSON.parse(json) as Record<string, unknown>;
    return typeof args.query === "string" ? args.query.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/**
 * What a finished run read and said, as numbered sources: each research call cites its address
 * (or the run, for a search), and the person's request and the reply cite their messages.
 * Empty when the run did no research, so nothing is distilled from small talk.
 */
export async function researchSources(
  prisma: PrismaClient,
  runId: string,
): Promise<DistillSource[]> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, threadId: true, sourceMessageId: true },
  });
  if (!run) return [];
  const replies = await prisma.message.findMany({
    where: { threadId: run.threadId, runId: run.id, role: "bot" },
    orderBy: { seq: "asc" },
    select: { id: true, blocks: true, toolHistory: true },
  });
  const research: DistillSource[] = [];
  for (const reply of replies) {
    for (const step of parseToolHistory(reply.toolHistory)?.steps ?? []) {
      if (!step || !RESEARCH_TOOLS.has(step.tool)) continue;
      for (const call of step.calls) {
        if (call.failed || !call.result?.trim()) continue;
        const url = urlFromArguments(call.arguments);
        const query = queryFromArguments(call.arguments);
        const citation: BrainCitation = url
          ? { kind: "url", ref: url }
          : {
              kind: "run",
              ref: run.id,
              label: `${step.tool}${query ? `: ${query}` : ""}`.slice(0, 200),
            };
        research.push({ citation, text: call.result });
      }
    }
  }
  if (research.length === 0) return [];
  const request = run.sourceMessageId
    ? await prisma.message.findUnique({
        where: { id: run.sourceMessageId },
        select: { id: true, blocks: true },
      })
    : null;
  const said: DistillSource[] = [
    ...(request
      ? [
          {
            citation: { kind: "message" as const, ref: request.id, label: "the request" },
            text: blocksToAgentHistoryText(storedMessageBlocks(request)),
          },
        ]
      : []),
    ...replies.map((reply) => ({
      citation: { kind: "message" as const, ref: reply.id, label: "Gente's answer" },
      text: blocksToAgentHistoryText(storedMessageBlocks(reply)),
    })),
  ].filter((source) => source.text.trim());
  return [...said, ...research].slice(0, MAX_SOURCES);
}

async function distillerModel(deps: BrainDistillDeps, owner: KnowledgeOwner, botId: string) {
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

/**
 * Distils one research run or one round of project feedback into the owner's brains and links
 * them to the project. A model that answers nothing usable changes nothing; a failed model call
 * throws so the queue tries again.
 */
export async function distillIntoBrains(
  deps: BrainDistillDeps,
  payload: BackgroundJobPayloads["brain.distill"],
): Promise<{ saved: string[] }> {
  const owner = { spaceId: payload.spaceId, userId: payload.userId };
  const project = payload.projectId
    ? await readProject(deps.prisma, owner, payload.projectId)
    : null;
  let sources: DistillSource[] = [];
  let threadId: string | null = null;
  let botId: string | null = null;
  if (payload.runId) {
    sources = await researchSources(deps.prisma, payload.runId);
    const run = await deps.prisma.run.findUnique({
      where: { id: payload.runId },
      select: { threadId: true, botId: true },
    });
    threadId = run?.threadId ?? null;
    botId = run?.botId ?? null;
  } else if (project && payload.feedback) {
    sources = [
      {
        citation: {
          kind: "project",
          ref: project.id,
          label: `feedback on ${project.name}`.slice(0, 200),
        },
        text: payload.feedback,
      },
    ];
  }
  if (sources.length === 0) return { saved: [] };
  if (!threadId || !botId) {
    const thread = await deps.prisma.thread.findFirst({
      where: {
        spaceId: owner.spaceId,
        botId: { not: null },
        ...(project?.threadIds.length ? { id: { in: project.threadIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, botId: true },
    });
    if (!thread?.botId) return { saved: [] };
    threadId = thread.id;
    botId = thread.botId;
  }

  const model = await distillerModel(deps, owner, botId);
  if (!deps.runtime.describe().capabilities.compaction || model.provider === "scripted") {
    getLogger().info("brain.distill skipped: no usable model");
    return { saved: [] };
  }
  const existing = await listBrains(deps.prisma, owner);
  const related = matchBrains(
    sources
      .map((source) => source.text)
      .join("\n")
      .slice(0, 8000),
    existing,
    {
      maxBrains: 2,
      extraSlugs: project?.brainSlugs,
    },
  ).map((match) => match.brain);
  const operationId = `brain-distill:${payload.runId ?? `${payload.projectId}:${Date.now()}`}`;
  let answer = "";
  for await (const event of deps.runtime.run(
    {
      botId,
      threadId,
      runId: operationId,
      usageOperationKind: "compaction",
      onUsage: async (usage) => {
        await recordUsage(deps.prisma, usage, {
          ...owner,
          botId: botId!,
          operationId,
          operationKind: "compaction",
        });
      },
      prompt: brainDistillPrompt(sources, related),
      instructions: brainDistillInstructions(),
      history: [],
      tools: [],
      model,
      allowSilentEmpty: true,
    },
    {
      operationId,
      traceId: operationId,
      ...owner,
      signal: AbortSignal.timeout(DISTILL_TIMEOUT_MS),
    },
  )) {
    if (event.type === "usage" && !event.accounted) {
      await recordUsage(deps.prisma, event, {
        ...owner,
        botId,
        operationId,
        operationKind: "compaction",
      });
    }
    if (event.type === "done" && event.text) answer = event.text;
  }
  if (/^(?:I hit a problem:|Unknown model )/i.test(answer.trim())) {
    throw new Error("brain.distill model call failed");
  }
  const updates = parseBrainDistillation(answer, sources);
  const now = new Date().toISOString();
  const saved: string[] = [];
  for (const update of updates) {
    const slug = brainSlug(update.topic);
    const current =
      existing.find((brain) => brain.slug === slug) ??
      related.find((brain) => brain.topic === update.topic) ??
      null;
    const merged = mergeBrain(current, update, now);
    await saveBrain(
      deps.prisma,
      owner,
      merged,
      payload.runId ? { sourceRunId: payload.runId } : {},
    );
    saved.push(merged.slug);
  }
  if (project && saved.length) {
    await updateProject(deps.prisma, owner, project.id, (current) =>
      saved.reduce(
        (next, slug) => applyProjectChange(next, { linkBrain: slug }, "bot", now),
        current,
      ),
    );
  }
  if (saved.length) await deps.events?.publishSpaceChange?.(owner.spaceId, "knowledge");
  return { saved };
}

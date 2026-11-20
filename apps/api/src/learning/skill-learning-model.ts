// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { Actor } from "@rakazo/contracts";
import type { SkillReplayJudge } from "@rakazo/core";
import {
  deadlineSignal,
  skillProposalInstructions,
  skillProposalPrompt,
  skillReplayJudgeInstructions,
  skillReplayJudgePrompt,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { recordUsage } from "@rakazo/db";

const FAILED = /^(?:I hit a problem:|Unknown model )/i;
const PROPOSE_TIMEOUT_MS = 4 * 60_000;
const JUDGE_TIMEOUT_MS = 2 * 60_000;

type UsageEvent = Extract<AgentRuntimeEvent, { type: "usage" }>;

export type SkillProposal = { after: string; reason: string };

/** Proposes skill edits and judges replays. Tests pass a scripted one; the app wires the model. */
export interface SkillLearningModel {
  propose(
    actor: Actor,
    botId: string,
    input: { skill: string; request: string; reply: string; feedback: string },
  ): Promise<SkillProposal | null>;
  /** Absent when no model can judge; replay then runs only its structure and safety checks. */
  judge?(actor: Actor, botId: string): SkillReplayJudge;
}

/** The first JSON object in a model's answer, or null. */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Uses the bot's own model connection, as the speech summary does. */
export function createSkillLearningModel(deps: {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  resolveModel: (scope: {
    userId: string;
    spaceId: string;
    botId: string;
  }) => Promise<AgentRunRequest["model"]>;
}): SkillLearningModel {
  async function ask(
    actor: Actor,
    botId: string,
    input: { instructions: string; prompt: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<string | null> {
    const scope = { userId: actor.userId, spaceId: actor.spaceId, botId };
    const id = `skill-learning:${randomUUID()}`;
    const record = async (event: UsageEvent) => {
      await recordUsage(deps.prisma, event, { ...scope, operationId: id, operationKind: "setup" });
    };
    const model = await deps.resolveModel(scope);
    if (!deps.runtime.describe().capabilities.compaction || model.provider === "scripted")
      return null;
    let answer = "";
    for await (const event of deps.runtime.run(
      {
        botId,
        threadId: id,
        runId: id,
        usageOperationKind: "setup",
        onUsage: record,
        prompt: input.prompt,
        instructions: input.instructions,
        history: [],
        tools: [],
        model,
        allowSilentEmpty: true,
      },
      {
        operationId: id,
        traceId: id,
        ...scope,
        signal: deadlineSignal(input.timeoutMs, input.signal),
      },
    )) {
      if (event.type === "usage" && !event.accounted) await record(event);
      if (event.type === "done" && event.text && !FAILED.test(event.text.trim()))
        answer = event.text.trim();
    }
    return answer || null;
  }

  return {
    async propose(actor, botId, input) {
      const answer = await ask(actor, botId, {
        instructions: skillProposalInstructions(),
        prompt: skillProposalPrompt(input),
        timeoutMs: PROPOSE_TIMEOUT_MS,
      });
      const parsed = answer ? parseModelJson(answer) : null;
      const after = typeof parsed?.skill === "string" ? parsed.skill.trim() : "";
      const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
      return after && reason ? { after: `${after}\n`, reason: reason.slice(0, 300) } : null;
    },
    judge(actor, botId) {
      return {
        async judge({ skillBefore, skillAfter, example, signal }) {
          const answer = await ask(actor, botId, {
            instructions: skillReplayJudgeInstructions(),
            prompt: skillReplayJudgePrompt({
              skillBefore,
              skillAfter,
              request: example.input,
              approved: example.approved,
            }),
            timeoutMs: JUDGE_TIMEOUT_MS,
            signal,
          });
          const parsed = answer ? parseModelJson(answer) : null;
          // Anything but a clear verdict is an error, which the replay counts as not passed.
          if (parsed?.verdict !== "pass" && parsed?.verdict !== "fail")
            throw new Error("No verdict");
          return {
            verdict: parsed.verdict,
            ...(typeof parsed.note === "string" ? { note: parsed.note.slice(0, 300) } : {}),
          };
        },
      };
    },
  };
}

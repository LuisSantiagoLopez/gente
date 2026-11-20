// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// Split out of run-tool-gate.ts (Rakazo, by Elie Steinbock) by DeskHead Inc. in 2026 for Gente.
//
// The automatic reviewer of a tool call: who judges it, on what words, and the verdict it stores.
import type { AdapterContext, AutoReviewRequest } from "@rakazo/adapter-kit";
import type { connectorKindFromToolName, resolveActionApprovalForTools } from "@rakazo/core";
import {
  applyJudgeDecision,
  BACKGROUND_HELPER_TRIGGER,
  HELPER_RESULT_TRIGGER,
  redactSecrets,
} from "@rakazo/core";
import { bestEffort } from "@rakazo/logging";
import type { AutoReviewChecker } from "../../approvals/auto-review.js";
import { redactToolArgsForReview } from "../../approvals/auto-review.js";
import type { AutoReviewCandidate } from "../../approvals/auto-review-backups.js";
import { reviewWithBackups } from "../../approvals/auto-review-backups.js";
import { reviewOwnerMessages } from "../../approvals/review-owner-messages.js";
import type { RunContext, RunTrust } from "../assembly/run-context.js";
import type { ExecutorDeps } from "../executor/executor-deps.js";
import type { recordEffect } from "../lifecycle/run-effects.js";
import { autoReviewCheckerProvider, includedAutoReviewChecker } from "../turn/run-auto-review.js";
import { auditToolCall } from "./run-tool-audit.js";

type AppliedEffect = Awaited<ReturnType<typeof recordEffect>>;

export type ToolReview = {
  name: string;
  args: Record<string, unknown>;
  connectorKind: ReturnType<typeof connectorKindFromToolName>;
  newSite: boolean;
  savedContextWrite: boolean;
  fetchUrl: string | undefined;
  matchingRules: ReturnType<typeof resolveActionApprovalForTools>["matchingRules"];
  gated: boolean;
  applied: AppliedEffect | undefined;
  injectedReview: ExecutorDeps["autoReview"];
  checker: AutoReviewChecker | null | undefined;
  reviewSettings: Awaited<ReturnType<RunTrust["loadApprovalModel"]>> | null;
  memberChecker: boolean;
};

/**
 * Run the configured reviewer (and its backups) on a call and store its verdict on the
 * effect. Returns nothing when there is no reviewer or the run was cancelled.
 */
export async function reviewToolCall(
  ctx: RunContext,
  review: ToolReview,
): Promise<{ reason: string | undefined; decision: "ask" | "allow" } | undefined> {
  const { deps, run, runId, bot, thread, context } = ctx;
  const { name, args, connectorKind, fetchUrl, gated, applied } = review;
  const { injectedReview, checker, reviewSettings, memberChecker } = review;
  if (!injectedReview && !checker && !reviewSettings?.backups.length) return;
  try {
    const delegated =
      run.trigger === BACKGROUND_HELPER_TRIGGER || run.trigger === HELPER_RESULT_TRIGGER;
    // A follow-up's task is a fixed "continue" prompt; the owner's latest words are its message.
    const continuation = run.trigger === "follow_up" || run.trigger === "messaging";
    const userTask = delegated
      ? await ctx.trust.loadOwnerWords()
      : (continuation && (await ctx.trust.loadOwnerWords()).trim()) || ctx.task.prompt;
    // Older helpers and deleted origins cannot establish authorization from their brief.
    if (delegated && !userTask.trim()) return { decision: "ask", reason: undefined };
    const botDescription = redactSecrets(`${bot.name}\n${bot.description}`, ctx.secrets);
    // A webhook run's task prompt carries the delivery, which someone else wrote, so the checker
    // gets only the owner's routine. With no routine to judge against, a person decides.
    const outsideRun = run.trigger === "webhook";
    const ownerWords = outsideRun ? await ctx.trust.loadOwnerWords() : "";
    if (outsideRun && !ownerWords.trim()) return { reason: undefined, decision: "ask" };
    // A new site, or a memory or skill save after outside content, is judged on the owner's own words only:
    // the task prompt of a webhook or bot-started run carries text someone else wrote.
    const ownerWordsOnly = (review.newSite && fetchUrl) || review.savedContextWrite;
    const reviewArgs =
      review.newSite && fetchUrl
        ? { url: redactSecrets(fetchUrl, ctx.secrets) }
        : redactToolArgsForReview(args, ctx.secrets);
    const ownerMessages = reviewOwnerMessages(
      // Extra context only: a failed lookup drops it and never fails the review.
      (
        (await bestEffort("auto_review.owner_messages", ctx.trust.loadEarlierOwnerMessages())) ?? []
      ).map((text) => redactSecrets(text, ctx.secrets)),
    );
    const reviewRequest: AutoReviewRequest = {
      toolName: name,
      connectorKind,
      args: reviewArgs,
      userTask: redactSecrets(
        outsideRun ? ownerWords : ownerWordsOnly ? await ctx.trust.loadOwnerWords() : userTask,
        ctx.secrets,
      ),
      botDescription,
      matchingRules: review.matchingRules,
      ...(review.newSite && fetchUrl ? { newSite: true } : {}),
      ...(review.savedContextWrite ? { savedContextWrite: true } : {}),
      ...(ownerMessages.length ? { ownerMessages } : {}),
    };
    const reviewContext: AdapterContext = {
      operationId: `auto-review:${runId}`,
      traceId: `auto-review:${runId}`,
      spaceId: run.spaceId,
      userId: run.userId,
      botId: bot.id,
      runId,
      signal: context.signal,
    };
    const checkerProvider = (candidate: AutoReviewCandidate) =>
      autoReviewCheckerProvider(
        deps,
        {
          runId,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          threadId: thread.id,
        },
        {
          injectedReview,
          memberChecker: candidate.role !== "default",
          registerSecrets: (values) => ctx.secrets.push(...values),
        },
        candidate,
      );
    // The fallback is extra: failing to look it up must not keep the chosen checkers from running.
    const included = injectedReview
      ? null
      : await bestEffort("auto_review.included_checker", includedAutoReviewChecker(deps));
    const includedIsPrimary =
      included &&
      checker &&
      !memberChecker &&
      checker.provider === included.provider &&
      checker.model === included.model &&
      !checker.credentialId &&
      !checker.creditOfferingId;
    const judge = await reviewWithBackups(
      [
        ...(checker
          ? [{ ...checker, role: memberChecker ? ("member" as const) : ("default" as const) }]
          : injectedReview
            ? [{ provider: "injected", model: "injected", role: "default" as const }]
            : []),
        ...(reviewSettings?.backups.map((choice) => ({
          provider: choice.provider,
          model: choice.modelId,
          thinkingLevel: choice.thinkingLevel,
          credentialId: choice.credentialId,
          creditOfferingId: choice.creditOfferingId,
          role: "backup" as const,
        })) ?? []),
        // A member's unusable choice falls back to the deployment's included reviewer.
        ...(included && !includedIsPrimary ? [{ ...included, role: "default" as const }] : []),
      ],
      async (checker) => {
        const provider = await checkerProvider(checker);
        return provider.review(reviewRequest, reviewContext);
      },
      context.signal,
    );
    if (context.signal.aborted) return;
    const verdict = {
      reason: judge.reason,
      decision: applyJudgeDecision({ decision: judge.decision, consequential: gated }),
    };
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: {
          reviewDecision: judge.decision,
          reviewReason: judge.reason,
          reviewModel: judge.model,
        },
      });
    }
    await auditAutoReview(ctx, name, applied, judge.decision, judge.model);
    return verdict;
  } catch {
    // Cancellation must not write a review the next attempt would reuse.
    if (context.signal.aborted) return;
    // Auth/refresh failures must fail closed like a checker error, not fail the run.
    const reviewReason = "Checker could not authenticate.";
    const verdict = {
      reason: reviewReason,
      decision: applyJudgeDecision({ decision: "error", consequential: gated }),
    };
    const reviewModel = checker
      ? `${checker.provider}/${checker.model}`
      : (injectedReview?.describe().id ?? "auto-review");
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: { reviewDecision: "error", reviewReason, reviewModel },
      });
    }
    await auditAutoReview(ctx, name, applied, "error", reviewModel);
    return verdict;
  }
}

function auditAutoReview(
  ctx: RunContext,
  tool: string,
  applied: AppliedEffect | undefined,
  decision: string,
  model: string | undefined,
): Promise<void> {
  return auditToolCall(
    ctx,
    tool,
    decision === "error" ? "failure" : "success",
    { effectId: applied?.effect.id, decision },
    { action: "approval.auto_reviewed", actor: { type: "system", label: model } },
  );
}

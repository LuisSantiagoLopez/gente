import type { MessageBlock } from "@rakazo/contracts";
import type { ToolStepOutcome } from "@rakazo/core";
import {
  appendTextSegment,
  appendToolCallSegment,
  createStreamingRedactor,
  endsSentence,
  isBackgroundRunTrigger,
  isConversationalRun,
  noteLastToolStep,
  redactSecrets,
  redactSecretsAfter,
  withToolStepOutcomes,
} from "@rakazo/core";
import type { Run } from "@rakazo/db";
import { storedMessageBlocks } from "@rakazo/db";
import { USER_COMPUTER_SCREEN_TOOLS } from "../../computers/host/user-computer-tools.js";
import { IMAGE_RETURNING_COMPUTER_TOOLS } from "../../models/model-vision.js";
import type { ReplyState, RunContext } from "../assembly/run-context.js";
import { publishMessage } from "../assembly/run-messages.js";
import {
  messageBlocksText,
  runAllowsSilentEmpty,
  runPromotesMidTurnNarration,
} from "../assembly/run-replies.prompt.js";
import {
  couldBecomeNoResponse,
  isExactNoResponse,
  isPlaceholderText,
} from "../assembly/silent-reply.js";
import type { ExecutorDeps } from "../executor/executor-deps.js";
import { PAGE_BROWSER_TOOL_NAMES } from "../tools/run-tool-selection.js";
import {
  clampUserProgressMessage,
  extractNarrationText,
  isUserProgressClientNonce,
  midTurnProgressBudgetAllows,
  narrationStatusLine,
  USER_PROGRESS_MESSAGE_MAX_LENGTH,
  userProgressClientNonce,
} from "./user-progress.js";

/** A fresh reply that knows the progress messages earlier attempts of this run posted. */
export async function createReplyState(
  deps: ExecutorDeps,
  run: Run,
  secrets: string[],
): Promise<ReplyState> {
  const reply: ReplyState = {
    assembled: "",
    currentTextSegment: "",
    messageSegments: [],
    publishedTerminalSubagent: false,
    publishedMidTurnUserMessage: false,
    discardedMidTurnNarration: false,
    lastDiscardedMidTurnNarration: "",
    explicitNoResponse: false,
    assistantTurnText: "",
    midTurnUserTexts: [],
    midTurnProgressCount: 0,
    turnStartedAtMs: run.startedAt?.getTime() ?? Date.now(),
    progressBudgetStart: 0,
    steeringReplyPending: false,
    computerTaskStarted: false,
    steeringResets: 0,
    lastSteeringResetAt: Number.NEGATIVE_INFINITY,
    workingNotes: [],
    textSinceLastStep: "",
    narrationSoFar: "",
    narrationStatusShowing: false,
    pendingToolNames: [],
    toolCalls: [],
    toolOutcomes: new Map(),
    toolStepCalls: new Map(),
    keptResultChars: 0,
    pendingProgress: "",
    lastProgressAt: 0,
    hasStreamedText: false,
    assistantTurnBreakPending: false,
    redactor: createStreamingRedactor(secrets),
  };
  const priorProgress = await deps.prisma.message.findMany({
    where: { runId: run.id, role: "bot" },
    orderBy: { seq: "asc" },
    select: { id: true, blocks: true, clientNonce: true },
  });
  for (const message of priorProgress) {
    if (!isUserProgressClientNonce(message.clientNonce)) continue;
    const text = messageBlocksText(storedMessageBlocks(message)).trim();
    if (!text) continue;
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
    reply.midTurnProgressCount += 1;
  }
  return reply;
}

export function recordExplicitNoResponse(reply: ReplyState, text: string) {
  reply.explicitNoResponse ||= isExactNoResponse(text) || /\bNO_RESPONSE\b/.test(text);
}

/** Durable interim messages only on genuinely long turns, capped per run. */
export function canPublishDurableProgress(reply: ReplyState) {
  return (
    reply.steeringReplyPending ||
    midTurnProgressBudgetAllows(progressSinceBudgetStart(reply), Date.now() - reply.turnStartedAtMs)
  );
}

const BROWSER_AND_DESKTOP_TOOLS = new Set([
  ...IMAGE_RETURNING_COMPUTER_TOOLS,
  ...PAGE_BROWSER_TOOL_NAMES,
  ...USER_COMPUTER_SCREEN_TOOLS,
]);

export function noteComputerTaskStep(reply: ReplyState, toolName: string) {
  if (BROWSER_AND_DESKTOP_TOOLS.has(toolName)) reply.computerTaskStarted = true;
}

/**
 * Browser and desktop tasks often take minutes, so the run's first interim message may tell
 * the person so at once. Runs nobody is waiting on keep the fresh-turn rule.
 */
export function canPostLongTaskHeadsUp(ctx: RunContext) {
  const { reply } = ctx.state;
  return (
    reply.computerTaskStarted &&
    reply.midTurnProgressCount === 0 &&
    isConversationalRun(ctx.run.trigger) &&
    !runAllowsSilentEmpty(ctx.run.trigger)
  );
}

export function progressSinceBudgetStart(reply: ReplyState) {
  return reply.midTurnProgressCount - reply.progressBudgetStart;
}

/** The next interim message's nonce; it uses up the allowance for answering the person. */
function nextProgressNonce(ctx: RunContext) {
  const { reply } = ctx.state;
  reply.steeringReplyPending = false;
  return userProgressClientNonce(ctx.run.id, reply.midTurnProgressCount++);
}

/**
 * Posts an interim message. A chat app gets a run's messages when the run ends, so a 1:1 run it
 * started sends this one on at once. A group run posts once, when it ends.
 */
export async function publishInterimMessage(ctx: RunContext, text: string, markUnread?: boolean) {
  const { deps, run } = ctx;
  const { reply } = ctx.state;
  await publishMessage(
    deps,
    run,
    "bot",
    [{ kind: "text", text }],
    markUnread,
    nextProgressNonce(ctx),
  );
  reply.midTurnUserTexts.push(text);
  reply.publishedMidTurnUserMessage = true;
  if (run.trigger === "messaging" && !ctx.source.channelId) {
    // Sent from here while the turn carries on; its rows' backup jobs cover a failed send.
    const delivery = deps.messagingDelivery;
    void delivery?.deliverRun(run.id, { progress: true }).catch((error) => {
      delivery.reportFailure("messaging progress delivery error", error);
    });
  }
}

/** Whether text written before a step may be posted as an interim message at all. */
export function narrationBecomesMessages(ctx: RunContext) {
  return ctx.replyMode === "chat" && runPromotesMidTurnNarration(ctx.run.trigger);
}

export function canPublishDurableNarration(ctx: RunContext) {
  return narrationBecomesMessages(ctx) && canPublishDurableProgress(ctx.state.reply);
}

export function flushPendingTools(reply: ReplyState) {
  if (reply.currentTextSegment) {
    reply.messageSegments = appendTextSegment(reply.messageSegments, reply.currentTextSegment);
    reply.currentTextSegment = "";
  }
  for (const name of reply.pendingToolNames) {
    reply.messageSegments = appendToolCallSegment(reply.messageSegments, name);
  }
  reply.pendingToolNames = [];
}

/**
 * The reply's steps with how each call ended. Calls with no result yet count as `unfinished`
 * when given (a stopped run), otherwise they carry no outcome.
 */
export function withReplyToolOutcomes(
  reply: ReplyState,
  unfinished?: ToolStepOutcome,
): MessageBlock[] {
  return withToolStepOutcomes(
    reply.messageSegments,
    reply.toolCalls.map(({ label, executionId, tool }) => ({
      label,
      outcome: reply.toolOutcomes.get(executionId) ?? unfinished,
      tool,
      call: reply.toolStepCalls.get(executionId),
    })),
  );
}

export function tryFlushPendingTools(reply: ReplyState) {
  if (reply.pendingToolNames.length > 0 && endsSentence(reply.currentTextSegment))
    flushPendingTools(reply);
}

/**
 * Silent-allowed runs keep a possible silence sentinel out of the live stream.
 * Once the text turns into a reply it all shows.
 */
export function progressHeldForSilence(ctx: RunContext) {
  const { reply } = ctx.state;
  return !reply.hasStreamedText && mayBeSilentEnding(ctx, reply.pendingProgress);
}

/** Text that may still become an allowed silent ending. */
export function mayBeSilentEnding(
  ctx: Pick<RunContext, "groupReplyOptional" | "allowSilentEmptyRun">,
  text: string,
) {
  return (
    ((ctx.groupReplyOptional || ctx.allowSilentEmptyRun) && couldBecomeNoResponse(text)) ||
    (ctx.groupReplyOptional && isPlaceholderText(text))
  );
}

/** Keep transient activity private for runs whose final reply may be silent. */
export function holdsTransientProgress(ctx: Pick<RunContext, "run" | "allowSilentEmptyRun">) {
  return (
    ctx.run.trigger === "routine" ||
    isBackgroundRunTrigger(ctx.run.trigger) ||
    (ctx.allowSilentEmptyRun && ctx.run.trigger === "follow_up")
  );
}

/**
 * Marks streamed text the person reads as the reply, so a call can say it while it is written.
 * Messages-mode text stays private and is never marked.
 */
export function shownProgress(ctx: Pick<RunContext, "replyMode">) {
  return ctx.replyMode === "chat" ? { shown: true as const } : {};
}

/** Gente: the longest streamed text, thinking or tool arguments wait before reaching the thread. */
export const PROGRESS_FLUSH_MS = 50;

/** Whether drafts can show: never in a run that may still end without a word. */
function showsDrafts(ctx: RunContext) {
  return (
    !ctx.scripted &&
    !holdsTransientProgress(ctx) &&
    !ctx.groupReplyOptional &&
    !ctx.allowSilentEmptyRun
  );
}

/** When the batched live output is due to be sent, or undefined when there is nothing to send. */
export function progressFlushDueAt(ctx: RunContext): number | undefined {
  const { reply } = ctx.state;
  if (ctx.scripted || holdsTransientProgress(ctx)) return undefined;
  const text = Boolean(reply.pendingProgress) && !progressHeldForSilence(ctx);
  if (!text && !(reply.pendingDraft && showsDrafts(ctx))) return undefined;
  return reply.lastProgressAt + PROGRESS_FLUSH_MS;
}

/** Gente: add thinking or tool-argument text the model is generating to the next flush. */
export function addDraft(
  ctx: RunContext,
  draft: { thinking?: string; tool?: { name: string; args: string }; reset?: true },
) {
  const { reply } = ctx.state;
  if (!showsDrafts(ctx)) return;
  if (draft.reset || !reply.draftRedactors) {
    reply.draftRedactors = {
      thinking: createStreamingRedactor(ctx.secrets),
      tool: createStreamingRedactor(ctx.secrets),
    };
  }
  if (draft.reset) {
    reply.pendingDraft = reply.draftShown ? { thinking: "", reset: true } : undefined;
    return;
  }
  const pending = reply.pendingDraft ?? { thinking: "" };
  if (draft.thinking) pending.thinking += reply.draftRedactors.thinking.push(draft.thinking);
  if (draft.tool) {
    const args = reply.draftRedactors.tool.push(draft.tool.args);
    // A new call's arguments replace the last one's in the view.
    if (pending.tool && pending.tool.name !== draft.tool.name) pending.tool = undefined;
    pending.tool = { name: draft.tool.name, args: (pending.tool?.args ?? "") + args };
  }
  if (pending.thinking || pending.tool || pending.reset) reply.pendingDraft = pending;
}

export async function flushProgress(ctx: RunContext) {
  const { deps, run, runId, bot, thread } = ctx;
  const { reply } = ctx.state;
  // Routines may finish silently. Do not leak narration or a partial silence
  // sentinel before the final outcome is known.
  if (ctx.scripted || holdsTransientProgress(ctx)) return;
  const text = reply.pendingProgress && !progressHeldForSilence(ctx) ? reply.pendingProgress : "";
  const draft = showsDrafts(ctx) ? reply.pendingDraft : undefined;
  if (!text && !draft) return;
  reply.pendingDraft = undefined;
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "thread.progress",
    runId,
    // The first flush replaces the "working…" placeholder outright — a delta here
    // would otherwise get appended straight onto it with no separator. A draft-only
    // update carries neither, so the text shown stays as it is.
    payload: {
      ...(text ? (reply.hasStreamedText ? { delta: text } : { text }) : {}),
      ...(draft ? { draft } : {}),
      streaming: true,
      ...shownProgress(ctx),
    },
  });
  if (draft) reply.draftShown = !draft.reset || Boolean(draft.thinking || draft.tool);
  if (text) {
    reply.hasStreamedText = true;
    reply.pendingProgress = "";
  }
  reply.lastProgressAt = Date.now();
}

/**
 * Text the bot wrote before a step. It is posted as an interim message when the budget allows
 * and it fits; otherwise it is a note on that step, kept out of the reply. Returns the note so
 * the caller can show it as the working line.
 */
export async function publishMidTurnNarration(ctx: RunContext, beforeConnectCard = false) {
  const { run } = ctx;
  const { reply } = ctx.state;
  const extracted = extractNarrationText(reply.messageSegments, reply.currentTextSegment);
  reply.messageSegments = extracted.remaining;
  reply.currentTextSegment = "";
  const text = redactSecretsAfter(reply.narrationSoFar, extracted.text, ctx.secrets).trim();
  reply.narrationSoFar += extracted.text;
  if (!text) return undefined;
  reply.assembled = "";
  reply.hasStreamedText = false;
  reply.pendingProgress = "";
  // Text the redactor still holds back belongs to the text just taken out.
  reply.redactor.skip();
  const promotes = runPromotesMidTurnNarration(run.trigger);
  if (
    text.length <= USER_PROGRESS_MESSAGE_MAX_LENGTH &&
    (canPublishDurableNarration(ctx) || (beforeConnectCard && narrationBecomesMessages(ctx)))
  ) {
    reply.workingNotes.length = 0;
    reply.narrationStatusShowing = false;
    await publishInterimMessage(ctx, text);
    return undefined;
  }
  reply.discardedMidTurnNarration = true;
  reply.lastDiscardedMidTurnNarration = clampUserProgressMessage(text);
  if (promotes && !ctx.allowSilentEmptyRun) {
    reply.workingNotes.push(text);
    flushPendingTools(reply);
    reply.messageSegments = noteLastToolStep(reply.messageSegments, text);
  }
  return text;
}

/**
 * Text the bot wrote before asking is what the person needs to answer, and a paused run
 * never reaches the final reply that would bring held notes back. Posts it whole, ahead of
 * the question.
 */
export async function publishNarrationBeforeAsk(ctx: RunContext) {
  const { run } = ctx;
  const { reply } = ctx.state;
  if (!runPromotesMidTurnNarration(run.trigger)) return;
  const extracted = extractNarrationText(reply.messageSegments, reply.currentTextSegment);
  const pending = redactSecretsAfter(reply.narrationSoFar, extracted.text, ctx.secrets).trim();
  reply.narrationSoFar += extracted.text;
  // Messages mode shows only the latest text, as at the end of a turn.
  const held =
    ctx.replyMode === "chat" ? reply.workingNotes : pending ? [] : reply.workingNotes.slice(-1);
  // Held notes were redacted against the secrets known when they were held; check them again.
  const text = redactSecrets([...held, pending].filter(Boolean).join("\n\n"), ctx.secrets);
  if (!text) return;
  reply.messageSegments = extracted.remaining;
  reply.currentTextSegment = "";
  reply.workingNotes.length = 0;
  reply.narrationStatusShowing = false;
  reply.assembled = "";
  reply.hasStreamedText = false;
  reply.pendingProgress = "";
  reply.redactor.skip();
  await publishInterimMessage(ctx, text);
}

/**
 * Replaces the text streamed so far with the note as the working line. Runs that hold their
 * narration back (routines, peers, background work) keep their live view.
 */
export async function showNarrationStatus(ctx: RunContext, note: string | undefined) {
  const { deps, run, runId, bot, thread } = ctx;
  if (
    !note ||
    ctx.scripted ||
    !runPromotesMidTurnNarration(run.trigger) ||
    isBackgroundRunTrigger(run.trigger)
  )
    return;
  ctx.state.reply.narrationStatusShowing = true;
  await deps.events.append({
    spaceId: run.spaceId,
    threadId: thread.id,
    botId: bot.id,
    type: "thread.progress",
    runId,
    payload: { reset: true, text: narrationStatusLine(note), activity: true },
  });
}

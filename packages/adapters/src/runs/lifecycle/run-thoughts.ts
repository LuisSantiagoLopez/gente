// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Keeps what the model thought, step by step, so the reply's activity row can show it after the
// run ends. Live thinking reaches the screen as short-lived progress events (run-progress.ts,
// addDraft); those are deleted when the run ends. Here each stretch of thinking is also saved as
// one "run.thought" event when it ends: when a tool starts, the reply starts, or the turn stops.
// Called from run-progress.ts (recordThought) and run-turn.ts (saveThought).
import { RunHistoryWriteError } from "@rakazo/db";
import type { RunContext } from "../assembly/run-context.js";

/** The longest thought saved; a longer one keeps its start and is marked cut. */
const THOUGHT_MAX_CHARS = 8_000;

type Thought = { text: string; startedAt: number };
const open = new WeakMap<RunContext, Thought>();

/** Adds thinking text, already redacted, to the stretch being thought now. */
export function recordThought(ctx: RunContext, text: string) {
  if (!text) return;
  const thought = open.get(ctx);
  if (thought) thought.text += text;
  else open.set(ctx, { text, startedAt: Date.now() });
}

/** Saves the stretch of thinking that just ended, if there was one. */
export async function saveThought(ctx: RunContext) {
  const thought = open.get(ctx);
  open.delete(ctx);
  const text = thought?.text.trim();
  if (!thought || !text || ctx.scripted) return;
  const { deps, run, runId, bot } = ctx;
  try {
    await deps.events.append({
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: bot.id,
      runId,
      type: "run.thought",
      lease: { owner: ctx.workerId, fence: ctx.fence },
      payload: {
        text: text.length > THOUGHT_MAX_CHARS ? `${text.slice(0, THOUGHT_MAX_CHARS)}…` : text,
        durationMs: Math.max(0, Date.now() - thought.startedAt),
      },
    });
  } catch (error) {
    // A superseded attempt owns nothing now; its thought is not this run's to save.
    if (!(error instanceof RunHistoryWriteError)) throw error;
  }
}

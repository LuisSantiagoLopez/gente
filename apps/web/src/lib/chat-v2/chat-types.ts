// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The shapes the chat screen draws: a list of turns, each a person's message and the AI's
// answer (its thinking, its tool steps, its reply text and any cards). Built by chat-state.ts
// and chat-snapshot.ts; drawn by components/chat/*.
import type { ThreadMessage } from "@rakazo/contracts";

/** One event from the thread's live stream (`/rpc/threads/subscribe`). */
export type ChatEvent = {
  type: string;
  id?: string;
  seq?: number;
  threadId?: string;
  botId?: string | null;
  runId?: string | null;
  createdAt?: string;
  payload?: Record<string, unknown>;
};

/** A stretch of the model's thinking. `live` while it is still being written. */
export type ThoughtStep = {
  kind: "thought";
  id: string;
  text: string;
  startedAt?: number;
  durationMs?: number;
  /** Shown from the live stream; the saved copy (a `run.thought` event) replaces it. */
  provisional?: boolean;
};

/** One tool call, such as writing a file or searching the web. */
export type ToolStep = {
  kind: "tool";
  id: string;
  name: string;
  /** The server's words for it while it runs, such as "Writing index.html". */
  label: string;
  input?: string;
  output?: string;
  status: "running" | "succeeded" | "failed" | "stopped";
  startedAt?: number;
  durationMs?: number;
};

export type Step = ThoughtStep | ToolStep;

/** A piece of reply text. Its key stays the same from the first token to the saved message. */
export type ReplyPart = {
  key: string;
  text: string;
  streaming: boolean;
  messageId?: string;
  /** The saved message, once there is one (for copy, reply and reactions). */
  message?: ThreadMessage;
  /** Where it sits among the turn's parts and cards. */
  order: number;
};

/** A saved message that is more than text: a question card, a page, a computer. */
export type TurnCard = { key: string; message: ThreadMessage; order: number };

export type AssistantStatus = "working" | "waiting" | "done" | "failed" | "stopped";

/** A file or other tool call the model is still writing. */
export type ToolDraft = { name: string; args: string; startedAt?: number };

export type AssistantView = {
  runId?: string;
  botId?: string;
  status: AssistantStatus;
  /** All the thinking of this answer, in order. */
  thinkingText: string;
  /** The thought being written now, not yet a step. */
  liveThought: string;
  steps: Step[];
  /** All reply text, joined. */
  replyText: string;
  parts: ReplyPart[];
  cards: TurnCard[];
  toolDraft?: ToolDraft;
  startedAt?: number;
  endedAt?: number;
  firstThoughtAt?: number;
  firstTokenAt?: number;
  /**
   * When thinking or reply text last streamed in this model call. The local model sends a tool
   * call only once it is complete, so a long silence after streaming means one is being written.
   */
  lastStreamAt?: number;
  error?: string;
};

export type Turn = {
  /** The person's message id, or the run id for an answer nobody asked for. */
  id: string;
  /** Lowest message seq in the turn, to keep turns in order. */
  seq: number;
  user?: ThreadMessage;
  assistant?: AssistantView;
};

export type ChatState = {
  turns: Turn[];
  /** The newest event seq applied; older repeats are skipped. */
  cursor: number;
};

export const EMPTY_CHAT: ChatState = { turns: [], cursor: -1 };

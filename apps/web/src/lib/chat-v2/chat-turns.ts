// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Small pure helpers for the chat state: find or add the turn a message or run belongs to,
// change one answer without touching the others, and sort saved messages into reply text or
// cards. Used by chat-state.ts (live events) and chat-snapshot.ts (a loaded chat).
import type { ThreadMessage } from "@rakazo/contracts";
import type { AssistantView, ChatState, ReplyPart, Turn, TurnCard } from "./chat-types";

export function ms(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function newAssistant(runId: string | undefined, botId?: string): AssistantView {
  return {
    ...(runId ? { runId } : {}),
    ...(botId ? { botId } : {}),
    status: runId ? "working" : "done",
    thinkingText: "",
    liveThought: "",
    steps: [],
    replyText: "",
    parts: [],
    cards: [],
  };
}

/** A saved message's reply text, or undefined when it is a card (or holds nothing to show). */
export function messageReplyText(message: ThreadMessage): string | undefined {
  const textOnly = message.blocks.every((block) => block.kind === "text" || block.kind === "steps");
  if (!textOnly) return undefined;
  return message.blocks
    .map((block) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Whether a saved message shows as a card (anything beyond plain text). */
export function isCardMessage(message: ThreadMessage): boolean {
  return messageReplyText(message) === undefined && message.blocks.length > 0;
}

function joinParts(parts: readonly ReplyPart[]) {
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n");
}

/** Text parts are keyed by their place, so the live part and its saved copy share a key. */
export function withSavedText(view: AssistantView, message: ThreadMessage): AssistantView {
  if (view.parts.some((part) => part.messageId === message.id)) return view;
  const text = messageReplyText(message);
  if (text === undefined || !text.trim()) return view;
  const saved = view.parts.filter((part) => !part.streaming);
  const parts = [
    ...saved,
    {
      key: `text-${saved.length}`,
      text,
      streaming: false,
      messageId: message.id,
      message,
      order: message.seq,
    },
  ];
  return { ...view, parts, replyText: joinParts(parts) };
}

export function withCard(view: AssistantView, message: ThreadMessage): AssistantView {
  if (view.cards.some((card) => card.message.id === message.id)) {
    const cards = view.cards.map((card) =>
      card.message.id === message.id ? { ...card, message } : card,
    );
    return { ...view, cards };
  }
  const card: TurnCard = { key: `card-${message.id}`, message, order: message.seq };
  return { ...view, cards: [...view.cards, card] };
}

/** Sets the reply text streaming now; it sits after every saved part. */
export function withLiveText(view: AssistantView, text: string, at?: number): AssistantView {
  const saved = view.parts.filter((part) => !part.streaming);
  const parts = text
    ? [
        ...saved,
        {
          key: `text-${saved.length}`,
          text,
          streaming: true,
          order: Number.MAX_SAFE_INTEGER,
        },
      ]
    : saved;
  return {
    ...view,
    parts,
    replyText: joinParts(parts),
    firstTokenAt: view.firstTokenAt ?? (text ? at : undefined),
  };
}

export function liveText(view: AssistantView): string {
  return view.parts.find((part) => part.streaming)?.text ?? "";
}

/** A turn's seq when its first message is not known yet: it sits at the end. */
export const UNKNOWN_SEQ = Number.MAX_SAFE_INTEGER;

/** Where a turn with this seq goes: after every turn with a lower or unknown seq. */
export function insertIndex(turns: readonly Turn[], seq: number): number {
  let index = turns.length;
  while (index > 0 && turns[index - 1]!.seq > seq && turns[index - 1]!.seq !== UNKNOWN_SEQ) index--;
  return index;
}

/** The turn holding a run, if any. */
export function turnIndexOfRun(state: ChatState, runId: string): number {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    if (state.turns[i]!.assistant?.runId === runId) return i;
  }
  return -1;
}

/**
 * Where a run's answer goes: the turn already holding it, else the turn whose person's message
 * started it (or the newest one still waiting for an answer), else a new turn of its own. The
 * returned state holds an answer for the run at `index`.
 */
export function placeRun(
  state: ChatState,
  runId: string,
  seq: number,
  botId?: string,
): { state: ChatState; index: number } {
  const held = turnIndexOfRun(state, runId);
  if (held >= 0) return { state, index: held };
  let index = -1;
  for (let i = state.turns.length - 1; i >= 0 && index < 0; i--) {
    const turn = state.turns[i]!;
    const runIds = (turn.user as { runIds?: unknown } | undefined)?.runIds;
    const asked = turn.user?.runId === runId || (Array.isArray(runIds) && runIds.includes(runId));
    if (asked && !turn.assistant?.runId) index = i;
  }
  const last = state.turns.at(-1);
  if (index < 0 && last?.user && !last.assistant?.runId) index = state.turns.length - 1;
  const turns = state.turns.slice();
  if (index < 0) {
    index = insertIndex(turns, seq);
    turns.splice(index, 0, { id: runId, seq });
  }
  const turn = turns[index]!;
  const prior = turn.assistant;
  turns[index] = {
    ...turn,
    assistant: prior
      ? { ...prior, runId, status: "working", ...(botId ? { botId } : {}) }
      : newAssistant(runId, botId),
  };
  return { state: { ...state, turns }, index };
}

/** Returns a state with one turn's answer changed; the other turns keep their identity. */
export function updateAssistant(
  state: ChatState,
  index: number,
  change: (view: AssistantView) => AssistantView,
): ChatState {
  const turn = state.turns[index];
  if (!turn) return state;
  const before = turn.assistant ?? newAssistant(undefined);
  const after = change(before);
  if (after === before && turn.assistant) return state;
  const turns = state.turns.slice();
  turns[index] = { ...turn, assistant: after };
  return { ...state, turns };
}

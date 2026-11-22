// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The chat-state reducer: folds one live event at a time into the turns the chat screen draws.
// It is pure: the same events always give the same turns. How each event changes one answer is
// in chat-run-events.ts. Events come from the thread's live
// stream (use-chat-state.ts); a loaded chat seeds the state first (chat-snapshot.ts).
//
// What each event does:
// - thread.message.created: a person's message starts a turn; a bot message becomes reply
//   text (replacing the streamed copy in the same place) or a card.
// - run.started: the turn's answer starts working.
// - thread.progress: reply text (`text` replaces, `delta` adds), live thinking
//   (`draft.thinking`) and a tool call being written (`draft.tool`).
// - run.thought: a saved stretch of thinking; it replaces the streamed copy.
// - agent.tool.called / agent.tool.completed: a tool step starts or ends.
// - run.waiting_input, run.completed, run.failed, run.cancelled: the answer pauses or ends.
// - thread.cleared: everything goes.
import type { ThreadMessage } from "@rakazo/contracts";
import { isBackgroundRunTrigger } from "@rakazo/core";
import {
  applyProgress,
  num,
  runEnded,
  savedThought,
  str,
  toolEnded,
  toolStarted,
} from "./chat-run-events";
import {
  insertIndex,
  isCardMessage,
  ms,
  placeRun,
  turnIndexOfRun,
  UNKNOWN_SEQ,
  updateAssistant,
  withCard,
  withLiveText,
  withSavedText,
} from "./chat-turns";
import type { AssistantView, ChatEvent, ChatState } from "./chat-types";
import { EMPTY_CHAT } from "./chat-types";

function messageCreated(state: ChatState, event: ChatEvent): ChatState {
  const payload = event.payload ?? {};
  const message: ThreadMessage & { runIds?: unknown } = {
    id: str(payload.messageId) ?? event.id ?? "",
    threadId: event.threadId ?? "",
    // The message's own seq (the event's seq counts thread events, not messages).
    seq: typeof payload.seq === "number" ? payload.seq : UNKNOWN_SEQ,
    role: (str(payload.role) as ThreadMessage["role"]) ?? "bot",
    blocks: (payload.blocks as ThreadMessage["blocks"]) ?? [],
    botId: event.botId ?? undefined,
    runId: event.runId ?? undefined,
    createdAt: event.createdAt ?? new Date(0).toISOString(),
    ...(payload.author ? { author: payload.author as ThreadMessage["author"] } : {}),
    ...(payload.runIds ? { runIds: payload.runIds } : {}),
  };
  return addMessage(state, message);
}

/** Adds one saved message to the turns. Also used when a loaded chat is turned into turns. */
export function addMessage(state: ChatState, message: ThreadMessage): ChatState {
  if (message.role === "user") {
    if (state.turns.some((turn) => turn.user?.id === message.id)) return state;
    const turns = state.turns.slice();
    turns.splice(insertIndex(turns, message.seq), 0, {
      id: message.id,
      seq: message.seq,
      user: message,
    });
    return { ...state, turns };
  }
  const add = (view: AssistantView) => {
    if (isCardMessage(message)) return withCard(view, message);
    if (view.parts.some((part) => part.messageId === message.id)) return view;
    // The saved reply replaces the streamed copy, in the same place.
    return withSavedText(withLiveText(view, ""), message);
  };
  if (message.runId) {
    const placed = placeRun(state, message.runId, message.seq, message.botId);
    const next = updateAssistant(placed.state, placed.index, add);
    // A turn made by its run takes the seq of its first saved message.
    const turn = next.turns[placed.index]!;
    if (turn.seq !== UNKNOWN_SEQ || message.seq === UNKNOWN_SEQ) return next;
    const turns = next.turns.slice();
    turns[placed.index] = { ...turn, seq: message.seq };
    return { ...next, turns };
  }
  // A message with no run (a welcome note) is an answer of its own.
  const turns = state.turns.slice();
  const index = insertIndex(turns, message.seq);
  turns.splice(index, 0, { id: message.id, seq: message.seq });
  return updateAssistant({ ...state, turns }, index, add);
}

/** Applies one live event. Events already applied (by seq) and unknown types change nothing. */
export function reduceChat(state: ChatState = EMPTY_CHAT, event: ChatEvent): ChatState {
  if (event.seq !== undefined && event.seq > 0 && event.seq <= state.cursor) return state;
  const advanced =
    event.seq !== undefined && event.seq > state.cursor ? { ...state, cursor: event.seq } : state;
  const at = ms(event.createdAt);
  const payload = event.payload ?? {};
  const runId = event.runId ?? undefined;
  switch (event.type) {
    case "thread.cleared":
      return { turns: [], cursor: advanced.cursor };
    case "thread.message.created":
      return messageCreated(advanced, event);
    case "run.started": {
      if (!runId || isBackgroundRunTrigger(str(payload.trigger))) return advanced;
      const placed = placeRun(advanced, runId, UNKNOWN_SEQ, event.botId ?? undefined);
      return updateAssistant(placed.state, placed.index, (view) => ({
        ...view,
        status: "working",
        startedAt: view.startedAt ?? at,
        endedAt: undefined,
        lastStreamAt: undefined,
      }));
    }
  }
  if (!runId) return advanced;
  const index = turnIndexOfRun(advanced, runId);
  // Progress and steps can arrive before run.started on a reconnect; they still belong somewhere.
  const placed =
    index >= 0 || !RUN_EVENTS.has(event.type)
      ? { state: advanced, index }
      : placeRun(advanced, runId, UNKNOWN_SEQ, event.botId ?? undefined);
  if (placed.index < 0) return advanced;
  return updateAssistant(placed.state, placed.index, (view) => {
    switch (event.type) {
      case "thread.progress":
        return applyProgress(view, payload, at);
      case "run.thought": {
        const text = str(payload.text)?.trim();
        return text ? savedThought(view, text, num(payload.durationMs), at) : view;
      }
      case "agent.tool.called":
        return toolStarted(view, payload, at);
      case "agent.tool.completed":
        return toolEnded(view, payload, at);
      case "run.waiting_input":
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
        return runEnded(view, event, at);
      default:
        return view;
    }
  });
}

const RUN_EVENTS = new Set(["thread.progress", "run.thought", "agent.tool.called"]);

/** Folds many events, oldest first. */
export function foldChat(events: readonly ChatEvent[], state: ChatState = EMPTY_CHAT) {
  return events.reduce(reduceChat, state);
}

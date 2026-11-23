// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Keeps the chat screen's turns up to date: starts from the loaded chat, applies every live
// event with the reducer (chat-state.ts), and merges the loaded chat again when its saved
// messages or steps change (a reload, older messages, an answered card). Used by
// components/chat/MessageList.tsx.
import { useLayoutEffect, useRef, useState } from "react";
import { onChatEvent } from "./chat-event-bus";
import type { ChatSnapshot } from "./chat-snapshot";
import { chatFromSnapshot, mergeChat } from "./chat-snapshot";
import { reduceChat } from "./chat-state";
import type { ChatState } from "./chat-types";
import { EMPTY_CHAT } from "./chat-types";

/** The parts of a snapshot whose change means saved things changed (not streamed text). */
function savedParts(snapshot: ChatSnapshot | null | undefined): unknown[] {
  if (!snapshot) return [];
  return [
    ...snapshot.messages.filter((message) => !message.id.startsWith("progress:")),
    snapshot.runActivity,
    snapshot.run?.status,
    ...(snapshot.activeRuns ?? []).map((run) => `${run.id}:${run.status}`),
  ];
}

function sameParts(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function useChatState(
  snapshot: ChatSnapshot | null | undefined,
  threadId: string | undefined,
): ChatState {
  const [state, setState] = useState<ChatState>(() =>
    snapshot ? chatFromSnapshot(snapshot) : EMPTY_CHAT,
  );
  useLayoutEffect(
    () =>
      onChatEvent((event) => {
        if (threadId && event.threadId && event.threadId !== threadId) return;
        setState((current) => reduceChat(current, event));
      }),
    [threadId],
  );
  const merged = useRef(savedParts(snapshot));
  useLayoutEffect(() => {
    const parts = savedParts(snapshot);
    if (!snapshot || sameParts(parts, merged.current)) return;
    merged.current = parts;
    setState((current) => mergeChat(current, chatFromSnapshot(snapshot)));
  });
  return state;
}

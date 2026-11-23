// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Hands each live thread event to the chat screen as it arrives. The thread sync
// (pages/shell/chat/use-thread-sync.ts) calls `emitChatEvent`; use-chat-state.ts listens.
import type { ChatEvent } from "./chat-types";

type Listener = (event: ChatEvent) => void;
const listeners = new Set<Listener>();

export function emitChatEvent(event: ChatEvent) {
  // A test or a proof run can keep a copy of the raw stream by setting this array.
  (globalThis as { __yaiEvents?: unknown[] }).__yaiEvents?.push({ at: Date.now(), event });
  for (const listener of listeners) listener(event);
}

export function onChatEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

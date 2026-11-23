// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Test helper: replays recorded live events the way the app does. Each event goes to the
// thread snapshot (the existing reducer in @rakazo/core) and to the chat-state reducer; when
// the snapshot's saved parts change, the loaded chat is merged in, as use-chat-state.ts does.
// Returns every intermediate chat state, so tests can check what the screen showed over time.
import type { LiveThreadSnapshot } from "@rakazo/core";
import { reduceThreadSnapshot } from "@rakazo/core";
import { chatFromSnapshot, mergeChat } from "./chat-snapshot";
import { reduceChat } from "./chat-state";
import type { ChatEvent, ChatState } from "./chat-types";

export function replay(events: readonly ChatEvent[], start?: LiveThreadSnapshot) {
  const first = events[0];
  let snapshot: LiveThreadSnapshot | null = start ?? {
    threadId: first?.threadId ?? "thread",
    cursor: (first?.seq ?? 1) - 1,
    olderCursor: null,
    messages: [],
    run: null,
    activeRuns: [],
  };
  let chat: ChatState = chatFromSnapshot(snapshot);
  const saved = (s: LiveThreadSnapshot | null) => [
    ...(s?.messages ?? []).filter((m) => !m.id.startsWith("progress:")),
    s?.runActivity,
    s?.run?.status,
    ...(s?.activeRuns ?? []).map((r) => `${r.id}:${r.status}`),
  ];
  let parts = saved(snapshot);
  const states: ChatState[] = [chat];
  for (const event of events) {
    chat = reduceChat(chat, event);
    snapshot = reduceThreadSnapshot(snapshot, event as Parameters<typeof reduceThreadSnapshot>[1]);
    const next = saved(snapshot);
    if (next.length !== parts.length || next.some((value, i) => value !== parts[i])) {
      parts = next;
      if (snapshot) chat = mergeChat(chat, chatFromSnapshot(snapshot));
    }
    states.push(chat);
  }
  return { chat, states, snapshot };
}

/** Every key the run's reply text had over time, in order, without repeats. */
export function replyKeysOverTime(states: readonly ChatState[], runId: string) {
  const keys: string[] = [];
  for (const state of states) {
    const turn = state.turns.find((t) => t.assistant?.runId === runId);
    const key = turn?.assistant?.parts.at(-1)?.key;
    const where = key ? `${turn!.id}/${key}` : undefined;
    if (where && keys.at(-1) !== where) keys.push(where);
  }
  return keys;
}

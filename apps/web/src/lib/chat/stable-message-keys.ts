// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// React keys for chat messages that stay the same while a reply streams and when it lands.
// A streaming reply is a live "progress:<run>" row; when the saved reply arrives, the row is
// swapped for a message with its own id. Keyed by id, React would throw the bubble away and
// mount a new one, which replays its entrance animation. Here the saved reply takes over the
// live row's key, so the same element stays and only its text changes. Used by transcript.tsx.

type KeyedMessage = { id: string; role: string; runId?: string | null };

export type StableKeyState = {
  /** Keys already handed to saved messages. */
  byMessage: Map<string, string>;
  /** The key of each run's live row, waiting for the message that replaces it. */
  liveKey: Map<string, string>;
  /** How many live rows each run has handed on, so the next one gets a new key. */
  handedOn: Map<string, number>;
};

export function createStableKeyState(): StableKeyState {
  return { byMessage: new Map(), liveKey: new Map(), handedOn: new Map() };
}

const isLiveRow = (message: KeyedMessage) => message.id.startsWith("progress:");

/** Each message's key. Mutates `state` so keys carry over from one render to the next. */
export function stableMessageKeys(
  messages: readonly KeyedMessage[],
  state: StableKeyState,
): Map<string, string> {
  const keys = new Map<string, string>();
  const used = new Set<string>();
  const liveRuns = new Set<string>();
  for (const message of messages) {
    if (!isLiveRow(message) || !message.runId) continue;
    const key = `live:${message.runId}:${state.handedOn.get(message.runId) ?? 0}`;
    state.liveKey.set(message.runId, key);
    liveRuns.add(message.runId);
    keys.set(message.id, key);
    used.add(key);
  }
  for (const message of messages) {
    if (keys.has(message.id)) continue;
    let key = state.byMessage.get(message.id);
    const runId = message.runId;
    if (!key && message.role === "bot" && runId && !liveRuns.has(runId)) {
      const live = state.liveKey.get(runId);
      if (live && !used.has(live)) {
        // This message replaced the run's live row: it keeps the row's element.
        key = live;
        state.liveKey.delete(runId);
        state.handedOn.set(runId, (state.handedOn.get(runId) ?? 0) + 1);
        state.byMessage.set(message.id, key);
      }
    }
    if (!key || used.has(key)) key = message.id;
    keys.set(message.id, key);
    used.add(key);
  }
  return keys;
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// One rented GPU per chat. A chat's first model request starts a Modal session (its own
// container); later requests from that chat reuse it. When the chat's answer is finished and
// nothing more comes for a short while, the session is stopped and the GPU goes away about a
// minute later (Modal's scale-down). Turning Cloud GPU off or quitting the app stops every one.
// Who calls it: model-router.ts (session, done, failed) and cloud-gpu-toggle.ts (stopAll, status).
import { GPU_DOLLARS_PER_HOUR } from "./cloud-gpu-config.js";

export type CloudSession = { url: string; token: string; gpu: string; startMs: number };

export type CloudGpuStatus =
  | { phase: "off" }
  | { phase: "starting"; since: number }
  | { phase: "on"; gpu: string; startMs: number; sessions: number }
  | { phase: "fallback"; message: string; at: number };

export interface SessionDeps {
  controlUrl: string;
  key: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Quiet time after a finished answer before the GPU is let go. */
  graceMs?: number;
  /** Quiet time in the middle of a task (a tool is running) before the GPU is let go anyway. */
  idleMs?: number;
  /** How long Modal keeps a session that the app forgot to stop (a crash). */
  serverIdleSeconds?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onChange?: () => void;
}

type Entry = {
  session: Promise<CloudSession>;
  ready?: CloudSession;
  startedAt: number;
  inFlight: number;
  timer?: unknown;
};

export const SPARE = "__spare__";

export function createCloudGpuSessions(deps: SessionDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const graceMs = deps.graceMs ?? 90_000;
  const idleMs = deps.idleMs ?? 5 * 60_000;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms).unref());
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout));
  const entries = new Map<string, Entry>();
  let fallback: { message: string; at: number } | null = null;
  const changed = () => deps.onChange?.();

  async function control(path: string, body: unknown): Promise<Response> {
    const key = await deps.key();
    if (!key) throw new Error("No Cloud GPU key in the Keychain");
    return doFetch(`${deps.controlUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60_000),
    });
  }

  async function open(): Promise<CloudSession> {
    const began = now();
    const res = await control("/start", { idle_timeout: deps.serverIdleSeconds ?? 300 });
    if (!res.ok) throw new Error(`Cloud GPU did not start (${res.status})`);
    const data = (await res.json()) as { url?: string; token?: string; gpu?: string };
    if (!data.url || !data.token) throw new Error("Cloud GPU sent no session");
    return { url: data.url, token: data.token, gpu: data.gpu ?? "GPU", startMs: now() - began };
  }

  function arm(key: string, ms: number) {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = setTimer(() => void stop(key), ms);
  }

  function begin(key: string): Entry {
    const entry: Entry = { session: open(), startedAt: now(), inFlight: 0 };
    entries.set(key, entry);
    changed();
    entry.session.then(
      (session) => {
        entry.ready = session;
        fallback = null;
        changed();
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
        changed();
      },
    );
    return entry;
  }

  /** The chat's session, started on its first request. A prewarmed spare is taken first. */
  async function session(key: string): Promise<CloudSession> {
    let entry = entries.get(key);
    if (!entry) {
      const spare = key === SPARE ? undefined : entries.get(SPARE);
      if (spare) {
        entries.delete(SPARE);
        entries.set(key, spare);
        entry = spare;
      } else entry = begin(key);
    }
    entry.inFlight += 1;
    if (entry.timer !== undefined) clearTimer(entry.timer);
    entry.timer = undefined;
    try {
      return await entry.session;
    } catch (error) {
      entry.inFlight -= 1;
      throw error;
    }
  }

  /** A request ended. A final answer starts the short wait; a tool call the longer one. */
  function done(key: string, finished: "answer" | "tool" | "aborted") {
    const entry = entries.get(key);
    if (!entry) return;
    entry.inFlight = Math.max(0, entry.inFlight - 1);
    if (entry.inFlight === 0) arm(key, finished === "tool" ? idleMs : graceMs);
  }

  /** The session stopped answering: forget it so the next request starts a fresh one. */
  function failed(key: string) {
    const entry = entries.get(key);
    entries.delete(key);
    if (entry?.ready) void control("/stop", { token: entry.ready.token }).catch(() => undefined);
    changed();
  }

  async function stop(key: string): Promise<void> {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    if (entry.timer !== undefined) clearTimer(entry.timer);
    changed();
    const ready = entry.ready ?? (await entry.session.catch(() => null));
    if (ready) await control("/stop", { token: ready.token }).catch(() => undefined);
  }

  return {
    session,
    done,
    failed,
    stop,
    stopAll: () => Promise.all([...entries.keys()].map(stop)).then(() => undefined),
    /** Starts a GPU before the first message, so the wait overlaps typing. */
    prewarm() {
      if (entries.size > 0) return;
      begin(SPARE);
      arm(SPARE, graceMs);
    },
    noteFallback(message: string) {
      fallback = { message, at: now() };
      changed();
    },
    status(): CloudGpuStatus {
      const list = [...entries.values()];
      const ready = list.flatMap((entry) => (entry.ready ? [entry.ready] : []));
      const first = ready[0];
      if (first)
        return { phase: "on", gpu: first.gpu, startMs: first.startMs, sessions: ready.length };
      if (list.length > 0)
        return { phase: "starting", since: Math.min(...list.map((e) => e.startedAt)) };
      if (fallback && now() - fallback.at < 60_000) return { phase: "fallback", ...fallback };
      return { phase: "off" };
    },
    /** Dollars per hour for the GPUs running now. */
    dollarsPerHour(): number {
      return [...entries.values()].reduce(
        (sum, entry) => sum + (entry.ready ? (GPU_DOLLARS_PER_HOUR[entry.ready.gpu] ?? 0) : 0),
        0,
      );
    },
  };
}

export type CloudGpuSessions = ReturnType<typeof createCloudGpuSessions>;

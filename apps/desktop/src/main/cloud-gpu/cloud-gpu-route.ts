// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Sends one chat request to the chat's rented GPU. If the GPU will not start or stops answering,
// it tries one fresh GPU, then gives up and returns null so this Mac's model answers instead,
// with a plain message in the status line. Who calls it: model-router.ts (the `cloud` dep).
import { readCloudGpuKey } from "./cloud-gpu-config.js";
import type { Finish } from "./cloud-gpu-request.js";
import { cloudChatBody, cloudHeaders, watchFinish } from "./cloud-gpu-request.js";
import type { MeterLine } from "./cloud-gpu-meter.js";
import { meterStream, withUsage } from "./cloud-gpu-meter.js";
import type { CloudGpuSessions } from "./cloud-gpu-sessions.js";

export const FALLBACK_MESSAGE = "Cloud GPU didn't answer, so this Mac answered instead.";
export const STILL_STARTING_MESSAGE = "Cloud GPU is still starting, so this Mac answered this step.";

/**
 * How long one request waits for its GPU to start. The runtime gives up on a request with no
 * reply headers after 120 s (twice, then the run fails), and the first start after a deploy can
 * take many minutes, so a slow start answers on this Mac and the GPU keeps starting for later.
 */
export const START_WAIT_MS = 90_000;
const STARTING = Symbol("starting");

export interface CloudRoute {
  active(): boolean;
  /** The GPU's streamed answer, or null when this computer should answer. */
  send(sessionKey: string, body: string): Promise<Response | null>;
}

export interface RouteDeps {
  sessions: CloudGpuSessions;
  active: () => boolean;
  fellBack: (message: string) => Promise<void> | void;
  recovered: () => Promise<void> | void;
  key?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  startWaitMs?: number;
  /** Gets first-token time, tokens per second and total for each answer. */
  meter?: (line: MeterLine) => void;
}

export function createCloudRoute(deps: RouteDeps): CloudRoute {
  const doFetch = deps.fetch ?? fetch;
  const key = deps.key ?? (() => readCloudGpuKey());
  /** Chats whose GPU already missed one wait: they answer here at once until it is up. */
  const slow = new Set<string>();

  async function once(sessionKey: string, body: string): Promise<Response | null | typeof STARTING> {
    const secret = await key();
    if (!secret) return null;
    const pending = deps.sessions.session(sessionKey);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<typeof STARTING>((resolve) => {
      const wait = slow.has(sessionKey) ? 0 : (deps.startWaitMs ?? START_WAIT_MS);
      timer = setTimeout(() => resolve(STARTING), wait);
      timer.unref?.();
    });
    const session = await Promise.race([pending.catch(() => null), waited]);
    clearTimeout(timer);
    if (session === STARTING) {
      // This request counted as in flight; once the GPU is up, start its idle clock.
      slow.add(sessionKey);
      pending.then(
        () => deps.sessions.done(sessionKey, "tool"),
        () => undefined,
      ).finally(() => slow.delete(sessionKey));
      return STARTING;
    }
    if (!session) return null;
    const answer = await doFetch(`${session.url}/v1/chat/completions`, {
      method: "POST",
      headers: cloudHeaders(session, secret),
      body,
    }).catch(() => null);
    if (!answer?.ok || !answer.body) {
      // Read and drop the error body so the connection is freed.
      await answer?.text().catch(() => undefined);
      deps.sessions.failed(sessionKey);
      return null;
    }
    const onEnd = (finish: Finish) => deps.sessions.done(sessionKey, finish);
    const watched = watchFinish(answer.body, onEnd);
    const stream = deps.meter ? meterStream(watched, sessionKey, deps.meter) : watched;
    return new Response(stream, {
      status: answer.status,
      headers: answer.headers,
    });
  }

  return {
    active: deps.active,
    async send(sessionKey, body) {
      const sent = withUsage(cloudChatBody(body));
      let answer = await once(sessionKey, sent);
      if (answer === null) answer = await once(sessionKey, sent);
      if (answer === STARTING) {
        await deps.fellBack(STILL_STARTING_MESSAGE);
        return null;
      }
      if (answer) await deps.recovered();
      else await deps.fellBack(FALLBACK_MESSAGE);
      return answer;
    },
  };
}

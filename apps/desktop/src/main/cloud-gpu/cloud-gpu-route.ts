// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Sends one chat request to the chat's rented GPU. If the GPU will not start or stops answering,
// it tries one fresh GPU, then gives up and returns null so this Mac's model answers instead,
// with a plain message in the status line. Who calls it: model-router.ts (the `cloud` dep).
import { readCloudGpuKey } from "./cloud-gpu-config.js";
import type { Finish } from "./cloud-gpu-request.js";
import { cloudChatBody, cloudHeaders, watchFinish } from "./cloud-gpu-request.js";
import type { CloudGpuSessions } from "./cloud-gpu-sessions.js";
import type { SharedGpu } from "./cloud-gpu-shared.js";

export type CloudMode = "shared" | "dedicated";

export const FALLBACK_MESSAGE = "Cloud GPU didn't answer, so this Mac answered instead.";

export interface CloudRoute {
  active(): boolean;
  /** The GPU's streamed answer, or null when this computer should answer. */
  send(sessionKey: string, body: string): Promise<Response | null>;
}

export interface RouteDeps {
  /** Dedicated mode: one GPU per chat. */
  sessions: CloudGpuSessions;
  /** Shared mode (the default): one warm GPU for many chats. */
  shared?: SharedGpu;
  mode?: () => CloudMode;
  active: () => boolean;
  fellBack: (message: string) => Promise<void> | void;
  recovered: () => Promise<void> | void;
  /** Each request counts as activity, so the spare GPU stays ready while a chat goes on. */
  activity?: () => void;
  key?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}

export function createCloudRoute(deps: RouteDeps): CloudRoute {
  const doFetch = deps.fetch ?? fetch;
  const key = deps.key ?? (() => readCloudGpuKey());

  async function once(sessionKey: string, body: string): Promise<Response | null> {
    const secret = await key();
    if (!secret) return null;
    const shared = deps.mode?.() !== "dedicated" ? deps.shared : undefined;
    const pool = shared ?? deps.sessions;
    const session = await pool.session(sessionKey).catch(() => null);
    if (!session) return null;
    const answer = await doFetch(`${session.url}/v1/chat/completions`, {
      method: "POST",
      headers: cloudHeaders(session, secret),
      body: shared ? withCacheSalt(body, shared.salt(sessionKey)) : body,
    }).catch(() => null);
    if (!answer?.ok || !answer.body) {
      // Read and drop the error body so the connection is freed.
      await answer?.text().catch(() => undefined);
      pool.failed(sessionKey);
      return null;
    }
    shared?.answered();
    const onEnd = (finish: Finish) => pool.done(sessionKey, finish);
    return new Response(watchFinish(answer.body, onEnd), {
      status: answer.status,
      headers: answer.headers,
    });
  }

  return {
    active: deps.active,
    async send(sessionKey, body) {
      deps.activity?.();
      const sent = cloudChatBody(body);
      const answer = (await once(sessionKey, sent)) ?? (await once(sessionKey, sent));
      if (answer) await deps.recovered();
      else await deps.fellBack(FALLBACK_MESSAGE);
      return answer;
    },
  };
}

/** vLLM keeps each salt's prompt cache apart, so chats on a shared GPU never share a cache. */
function withCacheSalt(body: string, salt: string): string {
  try {
    return JSON.stringify({ ...(JSON.parse(body) as object), cache_salt: salt });
  } catch {
    return body;
  }
}

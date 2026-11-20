// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Where the AI runs, decided per request on this computer:
//   - Private: always the model on this computer (Ollama on 127.0.0.1). Nothing goes out.
//   - Fast: Gente Cloud's GPU Swift (/v1/inference, OpenAI-compatible) with the person's sign-in,
//     when the cloud model is warm and the plan allows it; otherwise, silently, this computer's.
// Gente's server always talks to this loopback router, so switching modes needs no restart and
// the sign-in never reaches the server.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { Readable } from "node:stream";

export type AiMode = "fast" | "private";

export interface RouterDeps {
  localBase: string; // e.g. http://127.0.0.1:11434
  cloudBase: string; // e.g. https://gente-cloud.vercel.app/v1/inference
  mode: () => AiMode;
  /** The person's Gente Cloud token, or null when signed out. */
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Called for each answered chat request, so the app can show where it ran. */
  onAnswered?: (where: "cloud" | "local") => void;
}

/** How often the cloud model's state is checked, in the background. */
const STATUS_EVERY_MS = 30_000;

export async function startModelRouter(deps: RouterDeps) {
  const doFetch = deps.fetch ?? fetch;
  const secret = randomBytes(24).toString("hex");
  // The cloud model's state, refreshed in the background: a message never waits on it.
  let status: { at: number; warm: boolean } = { at: 0, warm: false };
  // Gente self-heal: a preferred side (expires), the last side used, this computer's last wait.
  let preferred: { where: "cloud" | "local"; until: number } | null = null;
  let lastRoute: "cloud" | "local" = "local";
  let localWait: { at: number; ms: number } | null = null;
  const prefers = (where: "cloud" | "local") =>
    preferred !== null && preferred.where === where && Date.now() < preferred.until;

  let refreshing: Promise<void> | null = null;
  /** Checks the cloud model (only in Fast mode, only signed in). Never called on a message's path. */
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      try {
        if (deps.mode() !== "fast") return;
        const token = await deps.token().catch(() => null);
        if (!token) {
          status = { at: Date.now(), warm: false };
          return;
        }
        const res = await doFetch(`${deps.cloudBase}/status`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        }).catch(() => null);
        const body = res?.ok
          ? ((await res.json().catch(() => null)) as { state?: string; status?: string } | null)
          : null;
        // Gente Cloud answers { state: "warm" | "waking" | "off" }; older builds said `status`.
        status = { at: Date.now(), warm: (body?.state ?? body?.status) === "warm" };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }
  void refresh();
  const timer = setInterval(() => void refresh(), STATUS_EVERY_MS);
  timer.unref();

  async function pipe(upstream: Response, res: ServerResponse) {
    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key))
        headers[key] = value;
    });
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as never).pipe(res);
  }

  async function forward(req: IncomingMessage, res: ServerResponse, body: Buffer | undefined) {
    const path = req.url ?? "/";
    const local = () =>
      doFetch(`${deps.localBase}${path}`, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] ?? "application/json" },
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      });
    const isChat = req.method === "POST" && path.startsWith("/v1/chat/completions");
    // When the cloud model isn't warm, this computer answers with no added wait: no sign-in
    // lookup and no status check on the message's path.
    if (isChat && deps.mode() === "fast" && !prefers("local") && status.warm) {
      const token = await deps.token().catch(() => null);
      if (token) {
        const cloud = await doFetch(`${deps.cloudBase}${path.replace(/^\/v1/, "")}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: new Uint8Array(body ?? Buffer.alloc(0)),
          signal: AbortSignal.timeout(120_000),
        }).catch(() => null);
        // Out of hours, not a paid plan, or the cloud is unwell: answer on this computer instead.
        if (cloud?.ok) {
          lastRoute = "cloud";
          deps.onAnswered?.("cloud");
          return pipe(cloud, res);
        }
        if (!cloud || cloud.status === 402 || cloud.status >= 500)
          status = { at: Date.now(), warm: false };
      }
    }
    const asked = Date.now();
    const answer = await local().catch(() => null);
    if (!answer) {
      res.writeHead(502).end();
      return;
    }
    if (isChat) {
      // The answer's headers arrive with its first token: that wait is what a person feels.
      localWait = { at: Date.now(), ms: Date.now() - asked };
      lastRoute = "local";
      deps.onAnswered?.("local");
    }
    return pipe(answer, res);
  }

  const server: Server = createServer(async (req, res) => {
    // The server holds a per-launch secret in its model URL path, so nothing else on this computer
    // can spend the person's hours through the router.
    const prefix = `/${secret}`;
    if (!req.url?.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    req.url = req.url.slice(prefix.length) || "/";
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await forward(req, res, Buffer.concat(chunks)).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    /** What the server uses as its model base URL (ends without /v1). */
    base: `http://127.0.0.1:${port}/${secret}`,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        server.close(() => resolve());
      }),
    /** Checks the cloud model now (tests, and right after sign-in or a mode switch). */
    refresh,
    /** Self-heal: lean to one side for a few minutes ("auto" clears it). Private mode stays local. */
    prefer: (where: "cloud" | "local" | "auto", forMs = 5 * 60_000) => {
      preferred = where === "auto" ? null : { where, until: Date.now() + forMs };
      if (where === "cloud") void refresh(); // check the cloud again right away
    },
    route: () => lastRoute,
    /** This computer's last time to first token, if it answered in the last two minutes. */
    localWaitMs: () => (localWait && Date.now() - localWait.at < 120_000 ? localWait.ms : null),
    /** The cloud model as last checked. */
    cloudWarm: () => status.warm,
  };
}

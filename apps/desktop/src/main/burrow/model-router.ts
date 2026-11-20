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

const STATUS_TTL_MS = 15_000;

export async function startModelRouter(deps: RouterDeps) {
  const doFetch = deps.fetch ?? fetch;
  const secret = randomBytes(24).toString("hex");
  let status: { at: number; warm: boolean } = { at: 0, warm: false };
  // Gente self-heal: a preferred side (expires), the last side used, this computer's last wait.
  let preferred: { where: "cloud" | "local"; until: number } | null = null;
  let lastRoute: "cloud" | "local" = "local";
  let localWait: { at: number; ms: number } | null = null;
  const prefers = (where: "cloud" | "local") =>
    preferred !== null && preferred.where === where && Date.now() < preferred.until;

  async function cloudWarm(token: string): Promise<boolean> {
    if (Date.now() - status.at < STATUS_TTL_MS) return status.warm;
    const res = await doFetch(`${deps.cloudBase}/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as { status?: string } | null)
      : null;
    status = { at: Date.now(), warm: body?.status === "warm" };
    return status.warm;
  }

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
    if (isChat && deps.mode() === "fast" && !prefers("local")) {
      const token = await deps.token().catch(() => null);
      if (token && (await cloudWarm(token))) {
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
        if (cloud?.status === 402 || (cloud && cloud.status >= 500))
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    /** Self-heal: lean to one side for a few minutes ("auto" clears it). Private mode stays local. */
    prefer: (where: "cloud" | "local" | "auto", forMs = 5 * 60_000) => {
      preferred = where === "auto" ? null : { where, until: Date.now() + forMs };
      if (where === "cloud") status = { at: 0, warm: false }; // check the cloud again right away
    },
    route: () => lastRoute,
    /** This computer's last time to first token, if it answered in the last two minutes. */
    localWaitMs: () => (localWait && Date.now() - localWait.at < 120_000 ? localWait.ms : null),
    /** The cloud model as last checked. */
    cloudWarm: () => status.warm,
  };
}

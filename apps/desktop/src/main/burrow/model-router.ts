// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente's server talks to this loopback router, which passes every model request to the model on
// this computer (Ollama on 127.0.0.1) and notes how long it took to start answering, for
// self-heal. With Cloud GPU on, chat requests go to the chat's rented GPU instead
// (cloud-gpu/cloud-gpu-route.ts); if that fails, this computer answers.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { sanitizeChatBody } from "@rakazo/adapters/chat-request-sanitizer";
import type { CloudRoute } from "../cloud-gpu/cloud-gpu-route.js";

export type AiMode = "fast" | "private";

export interface RouterDeps {
  localBase: string; // e.g. http://127.0.0.1:11434
  fetch?: typeof fetch;
  /** Called for each answered chat request. */
  onAnswered?: (where: "local" | "cloud") => void;
  /** Cloud GPU, when this Mac has a key for it. */
  cloud?: CloudRoute;
}

/** The chat a request belongs to (pi-ai sends it), so each chat gets its own GPU. */
function sessionKey(req: IncomingMessage): string {
  const value = req.headers["x-session-affinity"] ?? req.headers["x-session-id"];
  const key = Array.isArray(value) ? value[0] : value;
  return key?.trim().slice(0, 200) || "app";
}

export async function startModelRouter(deps: RouterDeps) {
  const doFetch = deps.fetch ?? fetch;
  const secret = randomBytes(24).toString("hex");
  let localWait: { at: number; ms: number } | null = null;

  async function pipe(upstream: Response, res: ServerResponse) {
    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key))
        headers[key] = value;
    });
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body as never);
    // The person stopped the answer: let the model (and a cloud session's timer) know.
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  }

  async function forward(req: IncomingMessage, res: ServerResponse, body: Buffer | undefined) {
    const path = req.url ?? "/";
    const isChat = req.method === "POST" && path.startsWith("/v1/chat/completions");
    const asked = Date.now();
    // The final check before the model: a resumed run never sends a call without its result.
    const sent =
      isChat && body && body.length > 0
        ? new TextEncoder().encode(sanitizeChatBody(body.toString("utf8")))
        : body && body.length > 0
          ? new Uint8Array(body)
          : undefined;
    if (isChat && sent && deps.cloud?.active()) {
      const cloud = await deps.cloud
        .send(sessionKey(req), new TextDecoder().decode(sent))
        .catch(() => null);
      if (cloud) {
        deps.onAnswered?.("cloud");
        return pipe(cloud, res);
      }
    }
    const answer = await doFetch(`${deps.localBase}${path}`, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] ?? "application/json" },
      body: sent,
    }).catch(() => null);
    if (!answer) {
      res.writeHead(502).end();
      return;
    }
    if (isChat) {
      // The answer's headers arrive with its first token: that wait is what a person feels.
      localWait = { at: Date.now(), ms: Date.now() - asked };
      deps.onAnswered?.("local");
    }
    return pipe(answer, res);
  }

  const server: Server = createServer(async (req, res) => {
    // The server holds a per-launch secret in its model URL path, so nothing else on this computer
    // can use the router.
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
    /** Self-heal asks to lean one way; everything already runs on this computer. */
    prefer: (_where: "cloud" | "local" | "auto") => undefined,
    route: () => "local" as const,
    /** This computer's last time to first token, if it answered in the last two minutes. */
    localWaitMs: () => (localWait && Date.now() - localWait.at < 120_000 ? localWait.ms : null),
    cloudWarm: () => false,
  };
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Connected apps through Gente Cloud: Gente's server sends its connected-apps MCP traffic to this
// loopback relay (secret path), which forwards it to Gente Cloud's connected-apps proxy with the
// person's fresh sign-in and passes the mcp-session-id header both ways. No vendor key is needed
// on this computer. A developer build without a sign-in may still use its own key.
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import {
  CONNECTED_APPS_DIRECT_URL,
  CONNECTED_APPS_KEY_HEADER,
} from "@rakazo/adapters/desktop-server-env";

export interface AppsRelayDeps {
  /** Gente Cloud's connected-apps proxy. */
  cloudUrl: string;
  /** Gente Cloud's media proxy (${GENTE_CLOUD_URL}/v1/proxy/media); the relay also serves /media. */
  mediaUrl?: string;
  token: () => Promise<string | null>;
  /** Developer builds only: a key for the connected-apps service itself when signed out. */
  devKey?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}

const PASS_UP = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const PASS_DOWN = ["content-type", "mcp-session-id", "cache-control"];

export async function startAppsRelay(deps: AppsRelayDeps) {
  const doFetch = deps.fetch ?? fetch;
  const secret = randomBytes(24).toString("hex");
  const server: Server = createServer(async (req, res) => {
    // Gente: images and video, with the person's sign-in only (no developer key path).
    if (deps.mediaUrl && req.url?.startsWith(`/${secret}/media`)) {
      const token = await deps.token().catch(() => null);
      if (!token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing_token" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rest = req.url.slice(`/${secret}/media`.length);
      const upstream = await doFetch(`${deps.mediaUrl}${rest}`, {
        method: req.method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: req.method === "GET" ? undefined : new Uint8Array(Buffer.concat(chunks)),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (!upstream) {
        res.writeHead(502).end();
        return;
      }
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    if (req.url !== `/${secret}/mcp`) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
    const headers: Record<string, string> = {};
    for (const name of PASS_UP) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const token = await deps.token().catch(() => null);
    let target = deps.cloudUrl;
    if (token) headers.authorization = `Bearer ${token}`;
    else {
      const key = await deps.devKey?.().catch(() => undefined);
      if (!key) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing_token", message: "Sign in to Gente to use connected apps." }));
        return;
      }
      target = CONNECTED_APPS_DIRECT_URL;
      headers[CONNECTED_APPS_KEY_HEADER] = key;
    }
    const upstream = await doFetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!upstream) {
      res.writeHead(502).end();
      return;
    }
    const down: Record<string, string> = {};
    for (const name of PASS_DOWN) {
      const value = upstream.headers.get(name);
      if (value) down[name] = value;
    }
    res.writeHead(upstream.status, down);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as never).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/${secret}/mcp`,
    mediaUrl: `http://127.0.0.1:${port}/${secret}/media`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

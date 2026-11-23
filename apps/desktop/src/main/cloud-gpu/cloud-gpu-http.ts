// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// One warm connection to the Cloud GPU. Node's fetch drops an idle connection after 4 s, so each
// message paid a fresh TCP + TLS handshake to Modal (several round trips across the country).
// This keeps the connection open and opens it while the person types.
// Who calls it: cloud-gpu-ipc.ts (as the route's fetch, and to warm the connection).
import https from "node:https";
import { Readable } from "node:stream";

// Idle sockets stay open until Modal's proxy closes them.
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 32 });

/** A fetch for the Cloud GPU over the warm connection. Streams the answer as it arrives. */
export const keepAliveFetch: typeof fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.protocol !== "https:") return fetch(input, init);
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req = https.request(
      url,
      { method: init?.method ?? "GET", headers, agent, signal: init?.signal ?? undefined },
      (res) => {
        const out = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) out.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = res.statusCode ?? 502;
        const body =
          status === 204 || status === 304 ? null : (Readable.toWeb(res) as ReadableStream);
        resolve(new Response(body, { status, headers: out }));
      },
    );
    req.on("error", reject);
    if (typeof init?.body === "string") req.end(init.body);
    else req.end();
  });
};

/** Opens (or keeps) the connection before the message is sent. */
export function warmConnection(baseUrl: string): void {
  keepAliveFetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(30_000) })
    .then((res) => res.body?.cancel())
    .catch(() => undefined);
}

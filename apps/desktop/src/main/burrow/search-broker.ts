// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Lets Gente's own server search through Gente Cloud without ever holding the person's sign-in:
// a loopback-only endpoint, guarded by a random token, that forwards one search to the cloud with
// the account's session. Signed out, it answers 404 and the server falls back to its own search.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { GenteCloud } from "./gente-cloud.js";

export interface SearchBroker {
  url: string;
  token: string;
  close(): Promise<void>;
}

export async function startSearchBroker(
  cloud: () => GenteCloud | null,
  signedIn: () => boolean,
): Promise<SearchBroker> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const server: Server = createServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? "");
    if (
      req.method !== "POST" ||
      req.url !== "/search" ||
      auth.length !== expected.length ||
      !timingSafeEqual(auth, expected)
    ) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) {
        res.writeHead(413).end();
        return;
      }
    }
    const query = (() => {
      try {
        return String((JSON.parse(raw) as { query?: unknown }).query ?? "")
          .slice(0, 500)
          .trim();
      } catch {
        return "";
      }
    })();
    const client = cloud();
    if (!query || !client || !signedIn()) {
      res.writeHead(404).end();
      return;
    }
    try {
      const data = await client.search(query, 4);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
    } catch {
      // Out of hours, offline or signed out at the cloud: the server uses its own search.
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/search`,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

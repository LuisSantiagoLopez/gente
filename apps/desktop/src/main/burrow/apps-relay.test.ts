// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startAppsRelay } from "./apps-relay.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe("Composio through Gente Cloud", () => {
  it("forwards MCP calls with the sign-in and passes the session id both ways", async () => {
    const seen: Record<string, string | undefined>[] = [];
    const cloud = createServer((req, res) => {
      seen.push({ auth: req.headers.authorization, session: req.headers["mcp-session-id"] as string | undefined });
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    await new Promise<void>((r) => cloud.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise((r) => cloud.close(() => r())));
    const relay = await startAppsRelay({
      cloudUrl: `http://127.0.0.1:${(cloud.address() as { port: number }).port}/v1/proxy/composio/mcp`,
      token: async () => "tok",
    });
    closers.push(relay.close);
    const first = await fetch(relay.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(first.headers.get("mcp-session-id")).toBe("sess-1");
    await fetch(relay.url, { method: "POST", headers: { "content-type": "application/json", "mcp-session-id": "sess-1" }, body: "{}" });
    expect(seen).toEqual([{ auth: "Bearer tok", session: undefined }, { auth: "Bearer tok", session: "sess-1" }]);
  });

  it("asks to sign in when there is no sign-in and no developer key", async () => {
    const relay = await startAppsRelay({ cloudUrl: "http://127.0.0.1:9/never", token: async () => null });
    closers.push(relay.close);
    const res = await fetch(relay.url, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect((await fetch(relay.url.replace("/mcp", "/other"), { method: "POST" })).status).toBe(404);
  });
});

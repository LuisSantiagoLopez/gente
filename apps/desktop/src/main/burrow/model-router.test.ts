// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startModelRouter } from "./model-router.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** A tiny model server that answers with its own name and records what it saw. */
async function fakeServer(name: string) {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: name }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return { url: `http://127.0.0.1:${port}`, seen };
}

describe("the AI runs on this computer", () => {
  it("passes every request straight to the model on this computer", async () => {
    const local = await fakeServer("local");
    const where: string[] = [];
    const r = await startModelRouter({ localBase: local.url, onAnswered: (w) => where.push(w) });
    closers.push(r.close);
    const res = await fetch(`${r.base}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({ from: "local" });
    expect(local.seen).toEqual(["POST /v1/chat/completions"]);
    expect(where).toEqual(["local"]);
    expect(r.route()).toBe("local");
    expect(r.localWaitMs()).not.toBeNull();
  });

  it("makes no other request: one message, one call to the model", async () => {
    const local = await fakeServer("local");
    const r = await startModelRouter({ localBase: local.url });
    closers.push(r.close);
    for (let i = 0; i < 5; i++)
      await fetch(`${r.base}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(local.seen).toHaveLength(5);
  });

  it("refuses callers without the per-launch secret", async () => {
    const local = await fakeServer("local");
    const r = await startModelRouter({ localBase: local.url });
    closers.push(r.close);
    const port = new URL(r.base).port;
    expect(
      (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST" })).status,
    ).toBe(404);
    expect(local.seen).toEqual([]);
  });
});

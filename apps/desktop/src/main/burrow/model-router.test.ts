// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AiMode } from "./model-router.js";
import { startModelRouter } from "./model-router.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** A tiny model server that answers with its own name. */
async function fakeServer(name: string, opts: { status?: string; chatStatus?: number } = {}) {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    if (req.url?.endsWith("/status"))
      return res.end(JSON.stringify({ state: opts.status ?? "warm" }));
    res.writeHead(opts.chatStatus ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: name }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return { url: `http://127.0.0.1:${port}`, seen };
}

async function router(mode: AiMode, cloudOpts = {}, token: string | null = "tok") {
  const local = await fakeServer("local");
  const cloud = await fakeServer("cloud", cloudOpts);
  const where: string[] = [];
  const r = await startModelRouter({
    localBase: local.url,
    cloudBase: `${cloud.url}/v1/inference`,
    mode: () => mode,
    token: async () => token,
    onAnswered: (w) => where.push(w),
  });
  closers.push(r.close);
  await r.refresh();
  const chat = async () =>
    (await (
      await fetch(`${r.base}/v1/chat/completions`, { method: "POST", body: "{}" })
    ).json()) as { from: string };
  return { r, local, cloud, where, chat };
}

describe("where the AI runs", () => {
  it("Private never leaves this computer, even when signed in", async () => {
    const t = await router("private");
    expect(await t.chat()).toEqual({ from: "local" });
    expect(t.cloud.seen).toEqual([]);
    expect(t.where).toEqual(["local"]);
  });

  it("Fast uses the cloud model with the sign-in when it is warm", async () => {
    const t = await router("fast");
    expect(await t.chat()).toEqual({ from: "cloud" });
    expect(t.cloud.seen.at(-1)).toBe("POST /v1/inference/chat/completions Bearer tok");
    expect(t.local.seen).toEqual([]);
  });

  it("Fast falls back to this computer when the cloud is waking, out of hours, or signed out", async () => {
    expect(await (await router("fast", { status: "waking" })).chat()).toEqual({ from: "local" });
    expect(await (await router("fast", { chatStatus: 402 })).chat()).toEqual({ from: "local" });
    expect(await (await router("fast", {}, null)).chat()).toEqual({ from: "local" });
  });

  it("refuses callers without the per-launch secret", async () => {
    const t = await router("fast");
    const port = new URL(t.r.base).port;
    expect(
      (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST" })).status,
    ).toBe(404);
  });

  it("when the cloud is off, Fast goes straight to this computer: no sign-in lookup, no status check", async () => {
    let tokenCalls = 0;
    const local = await fakeServer("local");
    const cloud = await fakeServer("cloud", { status: "off" });
    const r = await startModelRouter({
      localBase: local.url,
      cloudBase: `${cloud.url}/v1/inference`,
      mode: () => "fast",
      token: async () => {
        tokenCalls++;
        return "tok";
      },
    });
    closers.push(r.close);
    await r.refresh();
    const [tokensBefore, cloudBefore] = [tokenCalls, cloud.seen.length];
    for (let i = 0; i < 5; i++)
      expect(
        await (await fetch(`${r.base}/v1/chat/completions`, { method: "POST", body: "{}" })).json(),
      ).toEqual({ from: "local" });
    expect(tokenCalls).toBe(tokensBefore);
    expect(cloud.seen.length).toBe(cloudBefore);
  });

  it("adds under 50 ms over Private when Fast falls back to this computer", async () => {
    const time = async (mode: AiMode) => {
      const t = await router(mode, { status: "off" });
      await t.chat(); // warm the connection
      const start = performance.now();
      for (let i = 0; i < 20; i++) await t.chat();
      return (performance.now() - start) / 20;
    };
    const [privateMs, fastMs] = [await time("private"), await time("fast")];
    expect(fastMs - privateMs).toBeLessThan(50);
  });
});

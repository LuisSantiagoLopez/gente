// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests Cloud GPU through the model router: on, off, per chat, and fallback.
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudRoute, FALLBACK_MESSAGE } from "../cloud-gpu/cloud-gpu-route.js";
import { createCloudGpuSessions } from "../cloud-gpu/cloud-gpu-sessions.js";
import { createSharedGpu } from "../cloud-gpu/cloud-gpu-shared.js";
import { startModelRouter } from "./model-router.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const SSE =
  'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

async function setUp(options: { gpuWorks: boolean; on?: boolean }) {
  const local: string[] = [];
  const gpu: Array<{ model: string; auth: string; session: string }> = [];
  const control: string[] = [];
  const localUrl = await serve((req, res) => {
    local.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/event-stream" }).end(SSE);
  });
  const gpuUrl = await serve(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (!options.gpuWorks) return res.writeHead(503).end();
    gpu.push({
      model: JSON.parse(Buffer.concat(chunks).toString()).model,
      auth: String(req.headers.authorization),
      session: String(req.headers["modal-authorization"]),
    });
    res.writeHead(200, { "content-type": "text/event-stream" }).end(SSE);
  });
  let n = 0;
  const controlUrl = await serve((req, res) => {
    control.push(String(req.url));
    n += 1;
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ url: gpuUrl, token: `tok-${n}`, gpu: "H100" }));
  });
  const fallbacks: string[] = [];
  let on = options.on ?? true;
  const sessions = createCloudGpuSessions({ controlUrl, key: async () => "secret" });
  const cloud = createCloudRoute({
    sessions,
    active: () => on,
    fellBack: (m) => void fallbacks.push(m),
    recovered: () => undefined,
    key: async () => "secret",
  });
  const where: string[] = [];
  const router = await startModelRouter({
    localBase: localUrl,
    cloud,
    onAnswered: (w) => where.push(w),
  });
  closers.push(router.close);
  const chat = (thread: string) =>
    fetch(`${router.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-affinity": thread },
      body: JSON.stringify({ model: "yourai-default", messages: [], stream: true }),
    }).then((r) => r.text());
  return { chat, local, gpu, control, fallbacks, where, sessions, setOn: (v: boolean) => (on = v) };
}

describe("Cloud GPU in the model router", () => {
  it("with the switch on, sends the chat to the GPU with the key and the chat's session", async () => {
    const t = await setUp({ gpuWorks: true });
    expect(await t.chat("thread-1")).toContain('"content":"hi"');
    expect(t.gpu).toEqual([
      { model: "yourai-cloud", auth: "Bearer secret", session: "Bearer tok-1" },
    ]);
    expect(t.local).toEqual([]);
    expect(t.where).toEqual(["cloud"]);
  });

  it("gives two chats two GPUs", async () => {
    const t = await setUp({ gpuWorks: true });
    await t.chat("thread-1");
    await t.chat("thread-2");
    await t.chat("thread-1");
    expect(t.gpu.map((g) => g.session)).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-1"]);
  });

  it("with the switch off, this Mac answers and no GPU is rented", async () => {
    const t = await setUp({ gpuWorks: true, on: false });
    await t.chat("thread-1");
    expect(t.local).toEqual(["POST /v1/chat/completions"]);
    expect(t.control).toEqual([]);
  });

  it("falls back to this Mac with a plain message when the GPU fails", async () => {
    const t = await setUp({ gpuWorks: false });
    expect(await t.chat("thread-1")).toContain('"content":"hi"');
    expect(t.local).toEqual(["POST /v1/chat/completions"]);
    expect(t.fallbacks).toEqual([FALLBACK_MESSAGE]);
    expect(t.where).toEqual(["local"]);
    // It tried one fresh GPU before giving up.
    expect(t.control.filter((u) => u === "/start")).toHaveLength(2);
  });

  it("lets the chat's GPU go after the answer ends (stop-on-session-end)", async () => {
    const t = await setUp({ gpuWorks: true });
    await t.chat("thread-1");
    await t.sessions.stop("thread-1");
    expect(t.control).toEqual(["/start", "/stop"]);
    expect(t.sessions.status()).toEqual({ phase: "off" });
  });

  it("shared mode: one GPU for every chat, the key only, and this app's own cache salt", async () => {
    const seen: Array<{ salt: string; session?: string }> = [];
    const gpuUrl = await serve(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      seen.push({
        salt: JSON.parse(Buffer.concat(chunks).toString()).cache_salt,
        session: req.headers["modal-authorization"] as string | undefined,
      });
      res.writeHead(200, { "content-type": "text/event-stream" }).end(SSE);
    });
    const control: string[] = [];
    const controlUrl = await serve((req, res) => {
      control.push(String(req.url));
      res.end("{}");
    });
    const sessions = createCloudGpuSessions({ controlUrl, key: async () => "secret" });
    const cloud = createCloudRoute({
      sessions,
      shared: createSharedGpu({ url: gpuUrl }),
      mode: () => "shared",
      active: () => true,
      fellBack: () => undefined,
      recovered: () => undefined,
      key: async () => "secret",
    });
    const router = await startModelRouter({ localBase: "http://127.0.0.1:9", cloud });
    closers.push(router.close);
    for (const thread of ["a", "b", "a"])
      await fetch(`${router.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-affinity": thread },
        body: JSON.stringify({ model: "yourai-default", messages: [] }),
      }).then((r) => r.text());
    expect(control).toEqual([]); // nothing to start or stop
    expect(seen.map((s) => s.session)).toEqual([undefined, undefined, undefined]);
    // One salt for this app's chats (they share their long instructions), secret to others.
    expect(seen[0]?.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(seen.map((s) => s.salt)).size).toBe(1);
    expect(createSharedGpu({ url: gpuUrl }).salt("a")).not.toBe(seen[0]?.salt);
  });

  it("shared mode waits for a cold GPU (503 while it starts) instead of falling back", async () => {
    let calls = 0;
    const gpuUrl = await serve(async (req, res) => {
      for await (const _ of req) {
        // drain
      }
      calls += 1;
      if (calls < 3) return res.writeHead(503).end();
      res.writeHead(200, { "content-type": "text/event-stream" }).end(SSE);
    });
    const shared = createSharedGpu({ url: gpuUrl });
    const fallbacks: string[] = [];
    const cloud = createCloudRoute({
      sessions: createCloudGpuSessions({ controlUrl: gpuUrl, key: async () => "secret" }),
      shared,
      mode: () => "shared",
      active: () => true,
      fellBack: (m) => void fallbacks.push(m),
      recovered: () => undefined,
      key: async () => "secret",
    });
    const router = await startModelRouter({ localBase: "http://127.0.0.1:9", cloud });
    closers.push(router.close);
    const text = await fetch(`${router.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((r) => r.text());
    expect(text).toContain('"content":"hi"');
    expect(calls).toBe(3);
    expect(fallbacks).toEqual([]);
    expect(shared.status().phase).toBe("on");
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. A GPU that is slow to start never makes a chat request time out.
import { describe, expect, it } from "vitest";
import { createCloudRoute, STILL_STARTING_MESSAGE } from "./cloud-gpu-route.js";
import type { CloudGpuSessions } from "./cloud-gpu-sessions.js";

function slowSessions() {
  let release: () => void = () => {};
  const started = new Promise<void>((r) => (release = r));
  const done: string[] = [];
  const sessions = {
    session: async () => {
      await started;
      return { url: "https://gpu.example", token: "t", gpu: "H100", startMs: 1 };
    },
    done: (key: string, finish: string) => void done.push(`${key}:${finish}`),
    failed: () => undefined,
  } as unknown as CloudGpuSessions;
  return { sessions, release, done };
}

describe("Cloud GPU route", () => {
  it("answers on this Mac while the GPU is still starting, then uses the GPU", async () => {
    const { sessions, release, done } = slowSessions();
    const fallbacks: string[] = [];
    const sse = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n';
    const route = createCloudRoute({
      sessions,
      active: () => true,
      fellBack: (m) => void fallbacks.push(m),
      recovered: () => undefined,
      key: async () => "k",
      startWaitMs: 30,
      fetch: (async () => new Response(sse, { status: 200 })) as typeof fetch,
    });
    const body = JSON.stringify({ stream: true, messages: [] });
    const t0 = Date.now();
    expect(await route.send("chat-a", body)).toBeNull();
    expect(fallbacks).toEqual([STILL_STARTING_MESSAGE]);
    // A chat that already waited once does not wait again.
    const t1 = Date.now();
    expect(await route.send("chat-a", body)).toBeNull();
    expect(Date.now() - t1).toBeLessThan(25);
    expect(Date.now() - t0).toBeLessThan(1000);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toEqual(["chat-a:tool", "chat-a:tool"]);
    const answer = await route.send("chat-a", body);
    expect(answer?.status).toBe(200);
    expect(await answer?.text()).toContain("hi");
  });
});

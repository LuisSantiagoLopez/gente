// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests one GPU per chat, and that it stops when the chat is done.
import { describe, expect, it } from "vitest";
import { createCloudGpuSessions } from "./cloud-gpu-sessions.js";

function fakeControl() {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let n = 0;
  let failStart = false;
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ path, body });
    if (path === "/start") {
      if (failStart) return new Response("no", { status: 503 });
      n += 1;
      return Response.json({ url: `https://gpu.example/${n}`, token: `tok-${n}`, gpu: "H100" });
    }
    return Response.json({ stopped: true });
  }) as typeof globalThis.fetch;
  return { calls, fetch, failStarts: () => (failStart = true) };
}

function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    setTimer: (fn: () => void) => {
      id += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    fireAll: async () => {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
      await new Promise((r) => setTimeout(r, 0));
    },
    count: () => timers.size,
  };
}

function make() {
  const control = fakeControl();
  const timers = fakeTimers();
  const sessions = createCloudGpuSessions({
    controlUrl: "https://control.example",
    key: async () => "k",
    fetch: control.fetch,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { control, timers, sessions };
}

describe("Cloud GPU sessions", () => {
  it("gives each chat its own GPU and reuses it within the chat", async () => {
    const { control, sessions } = make();
    const a1 = await sessions.session("chat-a");
    sessions.done("chat-a", "tool");
    const a2 = await sessions.session("chat-a");
    const b = await sessions.session("chat-b");
    expect(a1.token).toBe(a2.token);
    expect(b.token).not.toBe(a1.token);
    expect(control.calls.filter((c) => c.path === "/start")).toHaveLength(2);
    expect(sessions.status()).toMatchObject({ phase: "on", gpu: "H100", sessions: 2 });
  });

  it("stops the GPU once the chat's answer is finished and the chat goes quiet", async () => {
    const { control, timers, sessions } = make();
    const s = await sessions.session("chat-a");
    expect(timers.count()).toBe(0); // no timer while a request is running
    sessions.done("chat-a", "answer");
    expect(timers.count()).toBe(1);
    await timers.fireAll();
    expect(control.calls.at(-1)).toEqual({ path: "/stop", body: { token: s.token } });
    expect(sessions.status()).toEqual({ phase: "off" });
  });

  it("a new message before the wait ends keeps the same GPU", async () => {
    const { control, timers, sessions } = make();
    await sessions.session("chat-a");
    sessions.done("chat-a", "answer");
    await sessions.session("chat-a");
    expect(timers.count()).toBe(0);
    expect(control.calls.map((c) => c.path)).toEqual(["/start"]);
  });

  it("stops every GPU when Cloud GPU is turned off or the app quits", async () => {
    const { control, sessions } = make();
    await sessions.session("chat-a");
    await sessions.session("chat-b");
    await sessions.stopAll();
    const stops = control.calls.filter((c) => c.path === "/stop").map((c) => c.body.token);
    expect(stops.sort()).toEqual(["tok-1", "tok-2"]);
    expect(sessions.status()).toEqual({ phase: "off" });
  });

  it("a GPU started while typing is taken by the next chat", async () => {
    const { control, sessions } = make();
    sessions.prewarm();
    const s = await sessions.session("chat-a");
    expect(s.token).toBe("tok-1");
    expect(control.calls.filter((c) => c.path === "/start")).toHaveLength(1);
  });

  it("a GPU that will not start is forgotten, so the next request tries again", async () => {
    const { control, sessions } = make();
    control.failStarts();
    await expect(sessions.session("chat-a")).rejects.toThrow(/did not start/);
    await new Promise((r) => setTimeout(r, 0));
    expect(sessions.status()).toEqual({ phase: "off" });
  });

  it("quitting does not wait for a GPU that is still starting, and stops it once it arrives", async () => {
    let release: (r: Response) => void = () => {};
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/start") return new Promise<Response>((r) => (release = r));
      return Response.json({ stopped: true });
    }) as typeof globalThis.fetch;
    const sessions = createCloudGpuSessions({
      controlUrl: "https://control.example",
      key: async () => "k",
      fetch,
      setTimer: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    sessions.prewarm();
    const started = Date.now();
    await sessions.stopAll();
    expect(Date.now() - started).toBeLessThan(1000);
    release(Response.json({ url: "https://gpu.example/1", token: "tok-1", gpu: "H100" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(["/start", "/stop"]);
  });
});

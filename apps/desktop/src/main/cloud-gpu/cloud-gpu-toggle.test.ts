// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests the Cloud GPU switch: saved, raises the window, stops GPUs when off.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLOUD_LIMITS } from "./cloud-gpu-config.js";
import { createCloudGpuSessions } from "./cloud-gpu-sessions.js";
import { createCloudGpuToggle, limitsFilePath } from "./cloud-gpu-toggle.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function make(hasKey = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cloud-gpu-"));
  dirs.push(dir);
  const stops: string[] = [];
  const sessions = createCloudGpuSessions({
    controlUrl: "https://control.example",
    key: async () => "k",
    fetch: (async (url: string) => {
      if (new URL(url).pathname === "/start")
        return Response.json({ url: "https://gpu.example", token: "t", gpu: "H100" });
      stops.push("stop");
      return Response.json({});
    }) as typeof fetch,
  });
  const toggle = createCloudGpuToggle({
    userDataDir: dir,
    stackDir: dir,
    sessions,
    hasKey: async () => hasKey,
  });
  await toggle.init();
  return { dir, toggle, sessions, stops };
}

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

describe("Cloud GPU switch", () => {
  it("starts off; turning it on saves the choice and gives runs the cloud window", async () => {
    const { dir, toggle } = await make();
    expect(toggle.state()).toMatchObject({ available: true, on: false });
    expect(toggle.active()).toBe(false);
    await toggle.set(true);
    expect(toggle.active()).toBe(true);
    expect((await readFile(path.join(dir, "cloud-gpu"), "utf8")).trim()).toBe("on");
    expect(JSON.parse(await readFile(limitsFilePath(dir), "utf8"))).toEqual(CLOUD_LIMITS);
  });

  it("turning it on starts a GPU at once; off stops every GPU and removes the cloud window", async () => {
    const { dir, toggle, sessions, stops } = await make();
    await toggle.set(true);
    expect(toggle.state().status.phase).toBe("starting");
    await sessions.session("chat-a"); // the chat takes the GPU started on switch-on
    await toggle.set(false);
    expect(stops).toEqual(["stop"]);
    expect(await exists(limitsFilePath(dir))).toBe(false);
    expect(toggle.state().status).toEqual({ phase: "off" });
  });

  it("stays off on a Mac without a Cloud GPU key", async () => {
    const { toggle } = await make(false);
    await toggle.set(true);
    expect(toggle.state()).toMatchObject({ available: false, on: false });
  });

  it("after a fallback, runs use this Mac's window again", async () => {
    const { dir, toggle, sessions } = await make();
    await toggle.set(true);
    await sessions.stopAll(); // the GPU started on switch-on did not come up
    await toggle.fellBack("Cloud GPU didn't answer, so this Mac answered instead.");
    expect(await exists(limitsFilePath(dir))).toBe(false);
    expect(toggle.state().status).toMatchObject({ phase: "fallback" });
    await toggle.recovered();
    expect(await exists(limitsFilePath(dir))).toBe(true);
  });
});

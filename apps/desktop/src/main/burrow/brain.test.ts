// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
import { mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM test helper without types
import { createOllamaStub } from "../../../scripts/ollama-stub.mjs";

type Stub = {
  server: import("node:http").Server;
  calls: { path: string; body: Record<string, unknown> }[];
};

const BEST = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q4_K_M";
const COMPACT = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q3_K_M";
const SMALL = "hf.co/ukisai/Swift-1.5-Ornith-9B-GGUF:Q4_K_M";

let stub: Stub | null = null;

async function setup(options: { failLoad?: string[]; installed?: string[] } = {}) {
  stub = createOllamaStub(options) as Stub;
  await new Promise<void>((resolve) => stub?.server.listen(0, "127.0.0.1", resolve));
  const port = (stub.server.address() as AddressInfo).port;
  vi.stubEnv("BURROW_OLLAMA_URL", `http://127.0.0.1:${port}`);
  vi.resetModules();
  const brainModule = await import("./brain.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "burrow-brain-"));
  const states: import("./brain.js").BrainState[] = [];
  const brain = new brainModule.Brain(dir, (state) => states.push(state));
  return { brain, brainModule, dir, states, calls: stub.calls };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => (stub ? stub.server.close(() => resolve()) : resolve()));
  stub = null;
});

const pulled = (calls: Stub["calls"]) =>
  calls.filter((c) => c.path === "/api/pull").map((c) => c.body.model);

describe("Burrow brain", () => {
  it("uses the best Swift when it loads, and never touches a smaller one", async () => {
    const { brain, dir, states, calls } = await setup();
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(BEST);
    expect(brain.current().switchedFrom).toBeUndefined();
    expect(pulled(calls)).toEqual([BEST]);
    const create = calls.find((c) => c.path === "/api/create");
    expect(create?.body).toMatchObject({ model: "swift-1.5-27b", from: BEST, parameters: { num_ctx: 32768 } });
    expect(states.some((s) => s.phase === "pulling" && s.totalBytes === 1000)).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved).toMatchObject({ model: BEST, alias: "swift-1.5-27b", installed: ["swift-1.5-27b"] });
  });

  it("switches to the next smaller Swift only after the best one really fails to load", async () => {
    const { brain, dir, calls } = await setup({ failLoad: [BEST] });
    await brain.start();
    const state = brain.current();
    expect(state.phase).toBe("ready");
    expect(state.model.tag).toBe(COMPACT);
    expect(state.switchedFrom).toBe("Swift 1.5 27B");
    // The best was tried first: pulled and loaded, and its load failed.
    expect(pulled(calls)).toEqual([BEST, COMPACT]);
    const loads = calls.filter((c) => c.path === "/api/generate").map((c) => c.body.model);
    expect(loads).toEqual(["swift-1.5-27b", "swift-1.5-27b-compact"]);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved.alias).toBe("swift-1.5-27b-compact");
    // The model that failed to load is not offered as a choice afterwards.
    expect(saved.installed).toEqual(["swift-1.5-27b-compact"]);
  });

  it("restarts the workspace only when the person switches to another model", async () => {
    const { brainModule, dir } = await setup();
    let restarts = 0;
    const brain = new brainModule.Brain(dir, () => {}, async () => {
      restarts++;
    });
    await brain.start();
    expect(restarts).toBe(0);
    await brain.start();
    expect(restarts).toBe(0);
    await brain.start({ model: SMALL });
    expect(brain.current().model.tag).toBe(SMALL);
    expect(restarts).toBe(1);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved.alias).toBe("swift-1.5-ornith-9b");
    expect(saved.installed).toEqual(["swift-1.5-27b", "swift-1.5-ornith-9b"]);
  });

  it("starts from the model the person picks", async () => {
    const { brain, calls } = await setup();
    await brain.start({ model: SMALL });
    expect(brain.current().model.tag).toBe(SMALL);
    expect(pulled(calls)).toEqual([SMALL]);
  });

  it("does not download again when the model is already there", async () => {
    const { brain, calls } = await setup({ installed: [BEST] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([]);
  });

  it("reports a failure when no Swift can run", async () => {
    const { brain } = await setup({ failLoad: [BEST, COMPACT, SMALL] });
    await brain.start();
    expect(brain.current().phase).toBe("failed");
    expect(brain.current().message).toContain("No Swift model could run");
  });

  it("makes the saved Swift every bot's default model", async () => {
    const { brainModule } = await setup();
    const env = brainModule.swiftServerEnv({
      model: BEST,
      alias: "swift-1.5-27b",
      installed: ["swift-1.5-27b", "swift-1.5-ornith-9b"],
      vision: [],
    });
    expect(env).toMatchObject({
      PI_DEFAULT_PROVIDER: "local",
      PI_DEFAULT_MODEL: "swift-1.5-27b",
      PI_DEFAULT_CREDENTIALS: "host",
      RAKAZO_LOCAL_MODELS: "swift-1.5-27b,swift-1.5-ornith-9b",
    });
    expect(brainModule.swiftServerEnv(null)).toEqual({});
  });
});

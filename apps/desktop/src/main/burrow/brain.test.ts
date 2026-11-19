// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
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
const COMPACT = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS";
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

describe("Gente brain", () => {
  it("uses the fast default (27B IQ2_XXS) when the person picks nothing", async () => {
    const { brain, dir, states, calls } = await setup();
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(COMPACT);
    // The 27B default also gets the quick model for small talk.
    expect(pulled(calls)).toEqual([COMPACT, SMALL]);
    const create = calls.find((c) => c.path === "/api/create");
    expect(create?.body).toMatchObject({ model: "swift-1.5-27b-iq2xxs", from: COMPACT, parameters: { num_ctx: 32768 } });
    expect(states.some((s) => s.phase === "pulling" && s.totalBytes === 1000)).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved).toMatchObject({ model: COMPACT, alias: "swift-1.5-27b-iq2xxs", userPicked: false });
  });

  it("uses the picked 27B, never falls back when it loads, and adds the quick small-talk model", async () => {
    const { brain, calls } = await setup();
    await brain.start({ model: BEST });
    expect(brain.current().model.tag).toBe(BEST);
    expect(brain.current().switchedFrom).toBeUndefined();
    expect(pulled(calls)).toEqual([BEST, SMALL]);
  });

  it("switches to the next smaller Swift only after the picked one really fails to load", async () => {
    const { brain, dir, calls } = await setup({ failLoad: [BEST] });
    await brain.start({ model: BEST });
    const state = brain.current();
    expect(state.phase).toBe("ready");
    expect(state.model.tag).toBe(COMPACT);
    expect(state.switchedFrom).toBe("Swift 1.5 27B Max");
    expect(pulled(calls)).toEqual([BEST, COMPACT, SMALL]);
    const loads = calls.filter((c) => c.path === "/api/generate" && c.body.keep_alive !== 0).map((c) => c.body.model);
    expect(loads).toEqual(["swift-1.5-27b-max", "swift-1.5-27b-iq2xxs", "swift-1.5-ornith-9b"]);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved.alias).toBe("swift-1.5-27b-iq2xxs");
    expect(saved.installed).toEqual(["swift-1.5-27b-iq2xxs", "swift-1.5-ornith-9b"]);
    expect(saved.chatAlias).toBe("swift-1.5-ornith-9b");
  });

  it("does not download again when the model is already there", async () => {
    const { brain, calls } = await setup({ installed: [COMPACT, SMALL] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([]);
  });

  it("reports a failure when no Swift can run", async () => {
    const { brain } = await setup({ failLoad: [BEST, COMPACT, SMALL] });
    await brain.start({ model: BEST });
    expect(brain.current().phase).toBe("failed");
    expect(brain.current().message).toContain("short on free memory");
    expect(brain.current().message).not.toMatch(/HTTP|GiB|error/i);
  });

  it("restarts the workspace and unloads the old model only when the person switches", async () => {
    const { brainModule, dir, calls } = await setup();
    let restarts = 0;
    const brain = new brainModule.Brain(dir, () => {}, async () => {
      restarts++;
    });
    await brain.start();
    await brain.start();
    expect(restarts).toBe(0);
    await brain.start({ model: BEST });
    expect(brain.current().model.tag).toBe(BEST);
    expect(restarts).toBe(1);
    const unloads = calls.filter((c) => c.path === "/api/generate" && c.body.keep_alive === 0);
    expect(unloads.map((c) => c.body.model)).toEqual(["swift-1.5-27b-iq2xxs"]);
    // A picked model stays picked when setup runs again without a new pick.
    await brain.start();
    expect(brain.current().model.tag).toBe(BEST);
  });

  it("moves a default Gente chose (27B) to the fast model on launch, but never a picked one", async () => {
    const { brainModule, dir } = await setup({ installed: [COMPACT] });
    const file = path.join(dir, "burrow-model.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ model: BEST, alias: "swift-1.5-27b-max", installed: ["swift-1.5-27b-max"] }));
    expect(await brainModule.moveToFastDefault(dir)).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ alias: "swift-1.5-27b-iq2xxs", userPicked: false });
    await writeFile(file, JSON.stringify({ model: BEST, alias: "swift-1.5-27b-max", installed: [], userPicked: true }));
    expect(await brainModule.moveToFastDefault(dir)).toBe(false);
  });

  it("makes the saved Swift every bot's default model", async () => {
    const { brainModule } = await setup();
    const env = brainModule.swiftServerEnv({
      model: SMALL,
      alias: "swift-1.5-ornith-9b",
      installed: ["swift-1.5-ornith-9b", "swift-1.5-27b-max"],
      vision: [],
    });
    expect(env).toMatchObject({
      PI_DEFAULT_PROVIDER: "local",
      PI_DEFAULT_MODEL: "swift-1.5-ornith-9b",
      BURROW_FAST_CHAT: "on",
      PAYMENT_WALLET_PROVIDER: "link",
      RAKAZO_LOCAL_MODELS: "swift-1.5-ornith-9b,swift-1.5-27b-max",
    });
    expect(brainModule.swiftServerEnv(null)).toEqual({});
  });
});

describe("Burrow brain, network trouble", () => {
  it("retries a failing download instead of switching models, then asks calmly", async () => {
    const { brainModule, dir, calls } = await setup();
    // Every pull fails (the stub answers 500 on a closed stream): simulate by a stub without /api/pull.
    stub?.server.removeAllListeners("request");
    stub?.server.on("request", (req, res) => {
      calls.push({ path: req.url ?? "", body: {} });
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "x" }));
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
      res.writeHead(500);
      res.end("{}");
    });
    brainModule.PULL_RETRY_MS.splice(0, 4, 1, 1, 1, 1);
    const brain = new brainModule.Brain(dir, () => {});
    await brain.start();
    expect(calls.filter((c) => c.path === "/api/pull")).toHaveLength(5);
    expect(brain.current().phase).toBe("failed");
    expect(brain.current().model.tag).toBe(COMPACT);
    expect(brain.current().message).toMatch(/internet/);
    expect(brain.current().message).not.toMatch(/HTTP|500/);
  });
});

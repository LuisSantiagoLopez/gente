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

const BEST = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS";
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

describe("Gente brain (one model: Swift 1.5 27B IQ2_XXS)", () => {
  const MODEL = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS";

  it("downloads and loads the one model, named swift-1.5-27b with a 32K context", async () => {
    const { brain, dir, states, calls } = await setup();
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(MODEL);
    expect(pulled(calls)).toEqual([MODEL]);
    const create = calls.find((c) => c.path === "/api/create");
    expect(create?.body).toMatchObject({ model: "swift-1.5-27b", from: MODEL, parameters: { num_ctx: 32768 } });
    expect(states.some((s) => s.phase === "pulling" && s.totalBytes === 1000)).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved).toMatchObject({ model: MODEL, alias: "swift-1.5-27b" });
    expect(saved.chatAlias).toBeUndefined();
  });

  it("never falls back to another model: a load that fails shows one calm sentence", async () => {
    const { brain, calls } = await setup({ failLoad: [MODEL] });
    await brain.start();
    expect(brain.current().phase).toBe("failed");
    expect(pulled(calls)).toEqual([MODEL]);
    expect(brain.current().message).toContain("short on free memory");
    expect(brain.current().message).not.toMatch(/HTTP|GiB|error/i);
  });

  it("does not download again when the model is already there", async () => {
    const { brain, calls } = await setup({ installed: [MODEL] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([]);
  });

  it("moves an older two-model setup to the one model on launch", async () => {
    const { brainModule, dir } = await setup({ installed: [MODEL] });
    const file = path.join(dir, "burrow-model.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ model: MODEL, alias: "swift-1.5-27b-iq2xxs", installed: [], chatAlias: "swift-1.5-ornith-9b" }));
    expect(await brainModule.moveToFastDefault(dir)).toBe(true);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({ alias: "swift-1.5-27b" });
    expect(saved.chatAlias).toBeUndefined();
  });

  it("makes the saved Swift every bot's default model", async () => {
    const { brainModule } = await setup();
    const env = brainModule.swiftServerEnv({ model: MODEL, alias: "swift-1.5-27b", installed: ["swift-1.5-27b"], vision: [] });
    expect(env).toMatchObject({
      PI_DEFAULT_PROVIDER: "local",
      PI_DEFAULT_MODEL: "swift-1.5-27b",
      BURROW_FAST_CHAT: "on",
      PAYMENT_WALLET_PROVIDER: "link",
      RAKAZO_LOCAL_MODELS: "swift-1.5-27b",
    });
    expect(env.BURROW_CHAT_MODEL).toBeUndefined();
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
    expect(brain.current().message).toMatch(/internet/);
    expect(brain.current().message).not.toMatch(/HTTP|500/);
  });
});

describe("Gente memory check", () => {
  it("tells an 8 GB computer, in one friendly sentence, before downloading anything", async () => {
    const os = await import("node:os");
    const spy = vi.spyOn(os.default, "totalmem").mockReturnValue(8 * 1024 ** 3);
    try {
      const { brain, calls } = await setup();
      await brain.start();
      expect(brain.current().phase).toBe("failed");
      expect(brain.current().message).toContain("at least 16 GB of memory");
      expect(calls.filter((c) => c.path === "/api/pull")).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

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

const MOE = "hf.co/unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ4_XS";
const BEST = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q4_K_M";
const COMPACT = "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS";
const SMALL = "hf.co/ukisai/Swift-1.5-Ornith-9B-GGUF:Q4_K_M";

let stub: Stub | null = null;

async function setup(
  options: { failLoad?: string[]; installed?: string[]; memoryGB?: number } = {},
) {
  stub = createOllamaStub(options) as Stub;
  if (options.memoryGB) vi.stubEnv("GENTE_E2E_MEMORY_GB", String(options.memoryGB));
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

describe("Your AI brain on 32 GB+: Qwen 3.6 35B-A3B", () => {
  it("downloads and loads it, named yourai-default with a 32K context", async () => {
    const { brain, dir, calls } = await setup({ memoryGB: 32 });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([MOE]);
    expect(calls.find((c) => c.path === "/api/create")?.body).toMatchObject({
      model: "yourai-default",
      from: MOE,
      parameters: { num_ctx: 32768 },
    });
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved).toMatchObject({ model: MOE, alias: "yourai-default", userPicked: false });
  });

  it("falls back to Swift Q4_K_M only when it can't load here", async () => {
    const { brain } = await setup({ memoryGB: 32, failLoad: [MOE] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(BEST);
  });

  it("moves a Swift default Your AI chose to it on launch, once it is downloaded", async () => {
    const { brainModule, dir } = await setup({ memoryGB: 32, installed: [MOE, BEST] });
    const file = path.join(dir, "burrow-model.json");
    const { writeFile } = await import("node:fs/promises");
    const swift = { model: BEST, alias: "swift-1.5-27b", installed: ["swift-1.5-27b"] };
    await writeFile(file, JSON.stringify({ ...swift, userPicked: false }));
    expect(await brainModule.moveToFastDefault(dir)).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      alias: "yourai-default",
      installed: ["yourai-default", "swift-1.5-27b"],
    });
    // A model the person picked stays.
    await writeFile(file, JSON.stringify({ ...swift, userPicked: true }));
    expect(await brainModule.moveToFastDefault(dir)).toBe(false);
  });
});

describe("Your AI brain (Swift 1.5 27B: Q4_K_M with 24 GB+, compact IQ2_XXS below)", () => {
  const MODEL = BEST;

  it("downloads and loads the Q4_K_M 27B on a 24 GB computer, named swift-1.5-27b with a 32K context", async () => {
    const { brain, dir, states, calls } = await setup({ memoryGB: 24 });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(BEST);
    expect(pulled(calls)).toEqual([BEST]);
    const create = calls.find((c) => c.path === "/api/create");
    expect(create?.body).toMatchObject({
      model: "swift-1.5-27b",
      from: BEST,
      parameters: { num_ctx: 32768 },
    });
    expect(states.some((s) => s.phase === "pulling" && s.totalBytes === 1000)).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dir, "burrow-model.json"), "utf8"));
    expect(saved).toMatchObject({ model: BEST, alias: "swift-1.5-27b" });
    expect(saved.chatAlias).toBeUndefined();
  });

  it("uses the compact IQ2_XXS build on a 16 GB computer", async () => {
    const { brain, calls } = await setup({ memoryGB: 16 });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([COMPACT]);
  });

  it("moves the alias up to Q4_K_M on a 24 GB computer where it pointed at IQ2_XXS", async () => {
    const { brain, calls } = await setup({
      memoryGB: 24,
      installed: [BEST, COMPACT, `swift-1.5-27b=${COMPACT}`],
    });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(calls.find((c) => c.path === "/api/create")?.body).toMatchObject({
      model: "swift-1.5-27b",
      from: BEST,
    });
  });

  it("never moves the alias back down to IQ2_XXS on launch", async () => {
    const { brain, calls } = await setup({
      memoryGB: 16,
      installed: [BEST, COMPACT, `swift-1.5-27b=${BEST}`],
    });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(calls.filter((c) => c.path === "/api/create")).toEqual([]);
    expect(pulled(calls)).toEqual([]);
  });

  it("falls back to the compact build only when Q4_K_M can't load here", async () => {
    const { brain, calls } = await setup({ memoryGB: 24, failLoad: [BEST] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(brain.current().model.tag).toBe(COMPACT);
    expect(calls.filter((c) => c.path === "/api/create").at(-1)?.body).toMatchObject({
      from: COMPACT,
    });
  });

  it("shows one calm sentence when no build can load", async () => {
    const { brain } = await setup({ memoryGB: 24, failLoad: [BEST, COMPACT] });
    await brain.start();
    expect(brain.current().phase).toBe("failed");
    expect(brain.current().message).toContain("short on free memory");
    expect(brain.current().message).not.toMatch(/HTTP|GiB|error/i);
  });

  it("does not download again when the model is already there", async () => {
    const { brain, calls } = await setup({ memoryGB: 24, installed: [MODEL] });
    await brain.start();
    expect(brain.current().phase).toBe("ready");
    expect(pulled(calls)).toEqual([]);
  });

  it("moves an older two-model setup to the one model on launch", async () => {
    const { brainModule, dir } = await setup({ memoryGB: 24, installed: [MODEL] });
    const file = path.join(dir, "burrow-model.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      file,
      JSON.stringify({
        model: MODEL,
        alias: "swift-1.5-27b-iq2xxs",
        installed: [],
        chatAlias: "swift-1.5-ornith-9b",
      }),
    );
    expect(await brainModule.moveToFastDefault(dir)).toBe(true);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toMatchObject({ alias: "swift-1.5-27b" });
    expect(saved.chatAlias).toBeUndefined();
  });

  it("makes the saved Swift every bot's default model", async () => {
    const { brainModule } = await setup();
    const env = brainModule.swiftServerEnv({
      model: MODEL,
      alias: "swift-1.5-27b",
      installed: ["swift-1.5-27b"],
      vision: [],
    });
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

describe("Your AI memory check", () => {
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

describe("getting the model ready as Your AI opens", () => {
  it("loads it once even when asked twice, before reading any prompt", async () => {
    const { brainModule, dir, calls } = await setup({ memoryGB: 24, installed: [BEST] });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(dir, "burrow-model.json"),
      JSON.stringify({ model: BEST, alias: "swift-1.5-27b", installed: ["swift-1.5-27b"] }),
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(dir, "data"), { recursive: true });
    await writeFile(
      path.join(dir, "data", "burrow-warm-chat.json"),
      JSON.stringify({ messages: [{ role: "system", content: "You are Chief." }] }),
    );
    await Promise.all([brainModule.prewarmSwift(dir), brainModule.prewarmSwift(dir)]);
    const work = calls.filter(
      (c) => c.path === "/api/generate" || c.path === "/v1/chat/completions",
    );
    expect(work.map((c) => c.path)).toEqual(["/api/generate", "/v1/chat/completions"]);
    expect(work[0]?.body).toMatchObject({ model: "swift-1.5-27b", prompt: "", keep_alive: -1 });
  });
});

describe("Ollama settings", () => {
  it("asks for the fast prompt cache as well as two requests and a model kept loaded", async () => {
    const { OLLAMA_SETTINGS } = await import("./brain.js");
    expect(OLLAMA_SETTINGS).toEqual({
      OLLAMA_NUM_PARALLEL: "2",
      OLLAMA_KEEP_ALIVE: "-1",
      OLLAMA_FLASH_ATTENTION: "1",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
    });
  });
});

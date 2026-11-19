// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
//
// Burrow's "brain": UkisAI's Swift model, run locally through Ollama.
// First run: find or install Ollama, pull the best Swift model, load it once.
// A smaller Swift is tried only after the best one really fails to download or load.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OLLAMA_URL = "http://127.0.0.1:11434";
const OLLAMA_ZIP_URL = "https://ollama.com/download/Ollama-darwin.zip";

export type SwiftModel = {
  /** The Ollama tag pulled from Hugging Face. */
  tag: string;
  /** The model id Burrow serves (the same weights, with a larger context window). */
  alias: string;
  name: string;
  sizeGB: number;
  note: string;
};

/** Best first. Each later entry is tried only after the one before it fails. */
const SWIFT_LADDER = [
  {
    tag: "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q4_K_M",
    alias: "swift-1.5-27b",
    name: "Swift 1.5 27B",
    sizeGB: 17.4,
    note: "Best quality. Needs a Mac with 32 GB memory.",
  },
  {
    tag: "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q3_K_M",
    alias: "swift-1.5-27b-compact",
    name: "Swift 1.5 27B Compact",
    sizeGB: 13.4,
    note: "Smaller copy of the 27B model for 24 GB Macs.",
  },
  {
    tag: "hf.co/ukisai/Swift-1.5-Ornith-9B-GGUF:Q4_K_M",
    alias: "swift-1.5-ornith-9b",
    name: "Swift 1.5 Ornith 9B",
    sizeGB: 5.8,
    note: "Fast and light, for 16 GB Macs.",
  },
] as const satisfies readonly SwiftModel[];
export const SWIFT_MODELS: readonly SwiftModel[] = SWIFT_LADDER;
const BEST_MODEL: SwiftModel = SWIFT_LADDER[0];

/** Context Burrow asks Ollama to load. Bots send long tool lists, so the 4K default is too small. */
export const SWIFT_CONTEXT = 32768;

export type BrainPhase =
  | "checking"
  | "ollama-missing"
  | "installing-ollama"
  | "starting-ollama"
  | "pulling"
  | "loading"
  | "ready"
  | "failed";

export type BrainState = {
  phase: BrainPhase;
  model: SwiftModel;
  completedBytes: number;
  totalBytes: number;
  message: string;
  /** Set when Burrow moved to a smaller Swift after a real failure. */
  switchedFrom?: string;
  models: readonly SwiftModel[];
};

export type SavedBrain = { model: string; alias: string; installed: string[]; vision?: string[] };

export function brainFile(stackDirectory: string) {
  return path.join(stackDirectory, "burrow-model.json");
}

export async function readSavedBrain(stackDirectory: string): Promise<SavedBrain | null> {
  try {
    const parsed = JSON.parse(await readFile(brainFile(stackDirectory), "utf8")) as SavedBrain;
    return typeof parsed.alias === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** The environment the API and worker get so Swift is every bot's default model. */
export function swiftServerEnv(saved: SavedBrain | null): Record<string, string> {
  if (saved === null) return {};
  const installed = [saved.alias, ...saved.installed.filter((id) => id !== saved.alias)];
  return {
    RAKAZO_LOCAL_MODELS: installed.join(","),
    RAKAZO_LOCAL_MODELS_URL: `${OLLAMA_URL}/v1`,
    RAKAZO_LOCAL_CONTEXT_WINDOW: String(SWIFT_CONTEXT),
    RAKAZO_LOCAL_MAX_TOKENS: "8192",
    RAKAZO_LOCAL_REASONING_MODELS: installed.join(","),
    RAKAZO_LOCAL_VISION_MODELS: (saved.vision ?? []).join(","),
    PI_DEFAULT_PROVIDER: "local",
    PI_DEFAULT_MODEL: saved.alias,
    PI_DEFAULT_CREDENTIALS: "host",
  };
}

async function ollama(pathname: string, init?: RequestInit, timeoutMs = 4000) {
  return fetch(`${OLLAMA_URL}${pathname}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export async function ollamaRunning(): Promise<boolean> {
  try {
    return (await ollama("/api/version")).ok;
  } catch {
    return false;
  }
}

function ollamaAppPath(): string | null {
  for (const candidate of [
    "/Applications/Ollama.app",
    path.join(os.homedir(), "Applications", "Ollama.app"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function ollamaCliPath(): string | null {
  for (const candidate of ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function ollamaInstalled() {
  return ollamaAppPath() !== null || ollamaCliPath() !== null;
}

/** Starts an installed Ollama in the background. Resolves once it answers, or false. */
export async function startOllama(): Promise<boolean> {
  if (await ollamaRunning()) return true;
  const appPath = ollamaAppPath();
  const cli = ollamaCliPath();
  if (appPath !== null) {
    spawn("/usr/bin/open", ["-g", "-j", appPath], { detached: true, stdio: "ignore" }).unref();
  } else if (cli !== null) {
    spawn(cli, ["serve"], { detached: true, stdio: "ignore" }).unref();
  } else {
    return false;
  }
  for (let i = 0; i < 40; i++) {
    if (await ollamaRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function installedTags(): Promise<string[]> {
  const res = await ollama("/api/tags");
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name);
}

/** Ollama lists "vision" when the GGUF came with its image projector. */
async function hasVision(model: string): Promise<boolean> {
  try {
    const res = await ollama("/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const body = (await res.json()) as { capabilities?: string[] };
    return (body.capabilities ?? []).includes("vision");
  } catch {
    return false;
  }
}

function hasTag(tags: string[], tag: string) {
  return tags.some((name) => name === tag || name === `${tag}:latest`);
}

export class Brain {
  private state: BrainState;
  private running: Promise<void> | null = null;

  constructor(
    private readonly stackDirectory: string,
    private readonly onChange: (state: BrainState) => void,
  ) {
    this.state = {
      phase: "checking",
      model: BEST_MODEL,
      completedBytes: 0,
      totalBytes: 0,
      message: "",
      models: SWIFT_MODELS,
    };
  }

  current(): BrainState {
    return this.state;
  }

  private set(patch: Partial<BrainState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  /** Checks, installs, pulls and loads. A no-op while a run is already going. */
  start(options: { installOllama?: boolean; model?: string } = {}): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.run(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(options: { installOllama?: boolean; model?: string }) {
    this.set({ phase: "checking", message: "", completedBytes: 0, totalBytes: 0 });
    if (!(await ollamaRunning())) {
      if (!ollamaInstalled()) {
        if (!options.installOllama) {
          this.set({ phase: "ollama-missing" });
          return;
        }
        try {
          await this.installOllama();
        } catch (error) {
          this.set({ phase: "failed", message: `Could not install Ollama: ${errorText(error)}` });
          return;
        }
      }
      this.set({ phase: "starting-ollama", completedBytes: 0, totalBytes: 0 });
      if (!(await startOllama())) {
        this.set({
          phase: "failed",
          message: "Ollama is installed but did not start. Open Ollama once, then retry.",
        });
        return;
      }
    }

    const start = Math.max(
      0,
      SWIFT_MODELS.findIndex((m) => m.tag === options.model || m.alias === options.model),
    );
    let firstFailure: string | undefined;
    for (let i = start; i < SWIFT_MODELS.length; i++) {
      const model = SWIFT_MODELS[i];
      if (model === undefined) break;
      this.set({
        model,
        switchedFrom: firstFailure,
        completedBytes: 0,
        totalBytes: 0,
        message: "",
      });
      try {
        await this.prepare(model);
        const tags = await installedTags();
        const installed = SWIFT_MODELS.filter((m) => hasTag(tags, m.alias)).map((m) => m.alias);
        const vision: string[] = [];
        for (const alias of installed) if (await hasVision(alias)) vision.push(alias);
        const saved: SavedBrain = { model: model.tag, alias: model.alias, installed, vision };
        await mkdir(this.stackDirectory, { recursive: true });
        await writeFile(brainFile(this.stackDirectory), `${JSON.stringify(saved, null, 2)}\n`);
        this.set({ phase: "ready" });
        return;
      } catch (error) {
        firstFailure ??= model.name;
        this.set({ message: `${model.name}: ${errorText(error)}` });
      }
    }
    this.set({
      phase: "failed",
      message: `No Swift model could run on this Mac. Last error: ${this.state.message}`,
    });
  }

  /** Pulls (resumable), names it with a larger context, and loads it once to prove it runs. */
  private async prepare(model: SwiftModel) {
    let tags = await installedTags();
    if (!hasTag(tags, model.tag)) {
      this.set({ phase: "pulling" });
      await this.pull(model.tag);
      tags = await installedTags();
    }
    if (!hasTag(tags, model.alias)) {
      const res = await ollama(
        "/api/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: model.alias,
            from: model.tag,
            parameters: { num_ctx: SWIFT_CONTEXT },
            stream: false,
          }),
        },
        120_000,
      );
      if (!res.ok) throw new Error(`could not prepare the model (${await res.text()})`);
    }
    this.set({ phase: "loading" });
    // An empty prompt only loads the model. A load that runs out of memory fails here.
    const res = await ollama(
      "/api/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: model.alias, prompt: "", keep_alive: "30m", stream: false }),
      },
      10 * 60_000,
    );
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `load failed (HTTP ${res.status})`);
  }

  private async pull(tag: string) {
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: tag, stream: true }),
    });
    if (!res.ok || res.body === null) throw new Error(`download failed (HTTP ${res.status})`);
    const layers = new Map<string, { total: number; completed: number }>();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastPush = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line === "") continue;
        const event = JSON.parse(line) as {
          status?: string;
          digest?: string;
          total?: number;
          completed?: number;
          error?: string;
        };
        if (event.error) throw new Error(event.error);
        if (event.digest && event.total) {
          layers.set(event.digest, { total: event.total, completed: event.completed ?? 0 });
        }
        const now = Date.now();
        if (now - lastPush > 250 || event.status === "success") {
          lastPush = now;
          let total = 0;
          let completed = 0;
          for (const layer of layers.values()) {
            total += layer.total;
            completed += layer.completed;
          }
          this.set({ totalBytes: total, completedBytes: completed });
        }
        if (event.status === "success") return;
      }
    }
    throw new Error("download stopped before it finished");
  }

  private async installOllama() {
    this.set({ phase: "installing-ollama", completedBytes: 0, totalBytes: 0 });
    const res = await fetch(OLLAMA_ZIP_URL, { redirect: "follow" });
    if (!res.ok || res.body === null) throw new Error(`download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get("content-length") ?? 0);
    const tmp = path.join(os.tmpdir(), `burrow-ollama-${process.pid}.zip`);
    const out = createWriteStream(tmp);
    let completed = 0;
    let lastPush = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      completed += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (Date.now() - lastPush > 250) {
        lastPush = Date.now();
        this.set({ completedBytes: completed, totalBytes: total });
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    const appsDir = path.join(os.homedir(), "Applications");
    await mkdir(appsDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/ditto", ["-x", "-k", tmp, appsDir], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
    });
    await rm(tmp, { force: true });
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

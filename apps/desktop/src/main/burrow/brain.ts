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

/** Ollama's default address. `BURROW_OLLAMA_URL` points tests at a stand-in server. */
export const OLLAMA_URL = process.env.BURROW_OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
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
    alias: "swift-1.5-27b-max",
    name: "Swift 1.5 27B Max",
    sizeGB: 17.4,
    note: "Highest quality. Uses about 19 GB of memory.",
  },
  {
    tag: "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS",
    alias: "swift-1.5-27b-iq2xxs",
    name: "Swift 1.5 27B",
    sizeGB: 8.9,
    note: "The default. Uses about 11 GB of memory.",
  },
  {
    tag: "hf.co/ukisai/Swift-1.5-Ornith-9B-GGUF:Q4_K_M",
    alias: "swift-1.5-ornith-9b",
    name: "Swift 1.5 Ornith 9B",
    sizeGB: 5.8,
    note: "For Macs and PCs with 16 GB or less.",
  },
] as const satisfies readonly SwiftModel[];
export const SWIFT_MODELS: readonly SwiftModel[] = SWIFT_LADDER;
/**
 * The model Burrow uses unless the person picks another: the 27B at IQ2_XXS (8.9 GB file, about
 * 11 GB loaded). Max quality (Q4_K_M) and the small Ornith 9B are one click away in the picker.
 */
export const DEFAULT_MODEL: SwiftModel = SWIFT_LADDER[1];
/** Answers greetings and small talk in about a second while a 27B handles real work. */
export const QUICK_MODEL: SwiftModel = SWIFT_LADDER[2];

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

export type SavedBrain = {
  model: string;
  alias: string;
  /** The small model that answers greetings while the main 27B handles real work. */
  chatAlias?: string;
  installed: string[];
  vision?: string[];
  /** True when the person picked this model; false when Burrow chose the default. */
  userPicked?: boolean;
};

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
    BURROW_FAST_CHAT: "on",
    ...(saved.chatAlias && saved.chatAlias !== saved.alias ? { BURROW_CHAT_MODEL: saved.chatAlias } : {}),
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

/** Where the official Windows installer puts Ollama (per user, no admin). */
function windowsOllamaDir(): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama");
}

/**
 * Settings Burrow wants from the model server: two requests at once (a chat and a routine) and
 * the model kept in memory so replies never wait for a reload.
 */
export const OLLAMA_SETTINGS = { OLLAMA_NUM_PARALLEL: "2", OLLAMA_KEEP_ALIVE: "-1" } as const;

function ollamaAppPath(): string | null {
  const candidates =
    process.platform === "win32"
      ? [path.join(windowsOllamaDir(), "ollama app.exe")]
      : ["/Applications/Ollama.app", path.join(os.homedir(), "Applications", "Ollama.app")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function ollamaCliPath(): string | null {
  const candidates =
    process.platform === "win32"
      ? [path.join(windowsOllamaDir(), "ollama.exe")]
      : ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"];
  for (const candidate of candidates) {
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
  const env = { ...process.env, ...OLLAMA_SETTINGS };
  if (process.platform === "win32") {
    if (cli === null) return false;
    // The tray app reads the user's environment, so keep Burrow's settings there too.
    for (const [name, value] of Object.entries(OLLAMA_SETTINGS)) {
      if (process.env[name] === undefined)
        spawn("setx", [name, value], { stdio: "ignore", windowsHide: true }).unref();
    }
    spawn(cli, ["serve"], { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
  } else if (appPath !== null) {
    // The Mac app keeps its own settings; Burrow does not change a person's Ollama app.
    spawn("/usr/bin/open", ["-g", "-j", appPath], { detached: true, stdio: "ignore" }).unref();
  } else if (cli !== null) {
    spawn(cli, ["serve"], { detached: true, stdio: "ignore", env }).unref();
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

/**
 * Sends the last chat's stable prefix (saved by the server as `data/burrow-warm.json`) to the
 * model with a one-token reply, so the first message after Burrow opens finds it already read.
 */
export async function prewarmSwift(stackDirectory: string): Promise<boolean> {
  const saved = await readSavedBrain(stackDirectory);
  if (saved === null) return false;
  // Small talk first: its slim prompt is quick to read, and "hey" is the usual first message.
  let warmed = false;
  for (const file of ["burrow-warm-chat.json", "burrow-warm.json"]) {
    try {
      const prefix = JSON.parse(
        await readFile(path.join(stackDirectory, "data", file), "utf8"),
      ) as { messages?: unknown[] };
      if (!Array.isArray(prefix.messages) || prefix.messages.length === 0) continue;
      const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...prefix,
          stream_options: undefined,
          // Always the current default: a prefix saved under another model would load that one.
          model: saved.alias,
          stream: false,
          max_completion_tokens: 1,
          max_tokens: 1,
          reasoning_effort: "none",
        }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      await res.text();
      warmed ||= res.ok;
    } catch {
      // Nothing saved yet, or the model server is busy; the first reply reads it instead.
    }
  }
  return warmed;
}

/** Asks Ollama to drop a model from memory now. */
export async function unloadModel(model: string): Promise<void> {
  try {
    await ollama(
      "/api/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0, stream: false }),
      },
      30_000,
    );
  } catch {
    // Already gone, or Ollama is down; either way it holds no memory.
  }
}

/**
 * Burrow 0.1 builds made the 27B model the default. On launch, move a default that Burrow chose
 * (not one the person picked) to the fast default when that model is already downloaded, and
 * unload the 27B. Returns true when the saved model changed, so the workspace restarts on it.
 */
export async function moveToFastDefault(stackDirectory: string): Promise<boolean> {
  const saved = await readSavedBrain(stackDirectory);
  if (saved === null || saved.userPicked === true || saved.alias === DEFAULT_MODEL.alias) return false;
  try {
    if (!(await ollamaRunning()) && !(await startOllama())) return false;
    let tags = await installedTags();
    if (!hasTag(tags, DEFAULT_MODEL.tag)) return false;
    if (!hasTag(tags, DEFAULT_MODEL.alias)) {
      const res = await ollama(
        "/api/create",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: DEFAULT_MODEL.alias,
            from: DEFAULT_MODEL.tag,
            parameters: { num_ctx: SWIFT_CONTEXT },
            stream: false,
          }),
        },
        120_000,
      );
      if (!res.ok) return false;
      tags = await installedTags();
    }
    const installed = [
      DEFAULT_MODEL.alias,
      ...saved.installed.filter((alias) => alias !== DEFAULT_MODEL.alias),
    ];
    const vision = (await hasVision(DEFAULT_MODEL.alias))
      ? [DEFAULT_MODEL.alias, ...(saved.vision ?? [])]
      : (saved.vision ?? []);
    const chatAlias = hasTag(tags, QUICK_MODEL.alias) ? QUICK_MODEL.alias : undefined;
    const next: SavedBrain = {
      model: DEFAULT_MODEL.tag,
      alias: DEFAULT_MODEL.alias,
      installed,
      vision,
      userPicked: false,
      ...(chatAlias ? { chatAlias } : {}),
    };
    await writeFile(brainFile(stackDirectory), `${JSON.stringify(next, null, 2)}\n`);
    if (saved.alias !== chatAlias) await unloadModel(saved.alias);
    return true;
  } catch {
    return false;
  }
}

export class Brain {
  private state: BrainState;
  private running: Promise<void> | null = null;

  constructor(
    private readonly stackDirectory: string,
    private readonly onChange: (state: BrainState) => void,
    /** Runs before "ready" when the default model changed, so the workspace restarts on it. */
    private readonly onModelChanged: () => Promise<void> = async () => {},
  ) {
    this.state = {
      phase: "checking",
      model: DEFAULT_MODEL,
      completedBytes: 0,
      totalBytes: 0,
      message: "",
      models: SWIFT_MODELS,
    };
  }

  /** Shows the saved model on the setup screen before anything runs. */
  async loadSaved(): Promise<void> {
    const saved = await readSavedBrain(this.stackDirectory);
    const model = SWIFT_MODELS.find((m) => m.alias === saved?.alias);
    if (model && this.state.phase === "checking") this.set({ model });
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

    const before = await readSavedBrain(this.stackDirectory);
    const picked = SWIFT_MODELS.findIndex(
      (m) => m.tag === options.model || m.alias === options.model,
    );
    // Without a new pick, keep a model the person picked before; otherwise the default.
    const kept = before?.userPicked ? SWIFT_MODELS.findIndex((m) => m.tag === before.model) : -1;
    const start = picked >= 0 ? picked : kept >= 0 ? kept : SWIFT_MODELS.indexOf(DEFAULT_MODEL);
    let firstFailure: string | undefined;
    const failed = new Set<string>();
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
        // A 27B gets a quick partner for small talk; shown to the person as one assistant.
        let chatAlias: string | undefined;
        if (model.alias !== QUICK_MODEL.alias) {
          try {
            this.set({ model: QUICK_MODEL, completedBytes: 0, totalBytes: 0 });
            await this.prepare(QUICK_MODEL);
            chatAlias = QUICK_MODEL.alias;
          } catch {
            chatAlias = undefined;
          }
          this.set({ model });
        }
        const tags = await installedTags();
        // A model that failed to load here is never offered again.
        const installed = SWIFT_MODELS.filter(
          (m) => hasTag(tags, m.alias) && !failed.has(m.alias),
        ).map((m) => m.alias);
        const vision: string[] = [];
        for (const alias of installed) if (await hasVision(alias)) vision.push(alias);
        const saved: SavedBrain = {
          model: model.tag,
          alias: model.alias,
          installed,
          vision,
          userPicked: picked >= 0 || kept >= 0,
          ...(chatAlias ? { chatAlias } : {}),
        };
        await mkdir(this.stackDirectory, { recursive: true });
        await writeFile(brainFile(this.stackDirectory), `${JSON.stringify(saved, null, 2)}\n`);
        if (before !== null && before.alias !== saved.alias) {
          await this.onModelChanged();
          // Free the memory the previous model held; it loads again if picked.
          if (before.alias !== chatAlias) await unloadModel(before.alias);
        }
        this.set({ phase: "ready" });
        return;
      } catch (error) {
        firstFailure ??= model.name;
        failed.add(model.alias);
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
    if (process.platform === "win32") return this.installOllamaWindows();
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

  /** The official installer, silent and per user (no admin prompt). */
  private async installOllamaWindows() {
    const setup = path.join(os.tmpdir(), `burrow-OllamaSetup-${process.pid}.exe`);
    await downloadTo(OLLAMA_WINDOWS_SETUP_URL, setup, (completedBytes, totalBytes) =>
      this.set({ completedBytes, totalBytes }),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(setup, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Ollama setup exited ${code}`)),
      );
    });
    await rm(setup, { force: true });
  }
}

export const OLLAMA_WINDOWS_SETUP_URL = "https://ollama.com/download/OllamaSetup.exe";

/** Downloads a file with progress pushed through `onBytes`. */
async function downloadTo(url: string, file: string, onBytes: (done: number, total: number) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || res.body === null) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = createWriteStream(file);
  let completed = 0;
  let lastPush = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    completed += chunk.length;
    if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    if (Date.now() - lastPush > 250) {
      lastPush = Date.now();
      onBytes(completed, total);
    }
  }
  await new Promise<void>((resolve, reject) =>
    out.end((err?: Error | null) => (err ? reject(err) : resolve())),
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

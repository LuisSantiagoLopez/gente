// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente's "brain": UkisAI's Swift model, run locally through Ollama.
// First run: find or install Ollama, pull the best Swift model, load it once.
// A smaller Swift is tried only after the best one really fails to download or load.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WireMessage } from "@rakazo/adapters/chat-request-sanitizer";
import { sanitizeChatMessages } from "@rakazo/adapters/chat-request-sanitizer";
import { limitsFilePath } from "../cloud-gpu/cloud-gpu-toggle.js";

/** Ollama's default address. `BURROW_OLLAMA_URL` points tests at a stand-in server. */
export const OLLAMA_URL = process.env.BURROW_OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
const OLLAMA_ZIP_URL = "https://ollama.com/download/Ollama-darwin.zip";

export type SwiftModel = {
  /** The Ollama tag pulled from Hugging Face. */
  tag: string;
  /** The model id Your AI serves (the same weights, with a larger context window). */
  alias: string;
  name: string;
  sizeGB: number;
  note: string;
  /** Ollama's name for the weights' quantization, to tell which ones the alias points at. */
  quant: string;
  /** The computer memory this model needs, in GB. */
  minMemoryGB: number;
};

/** Best first. Each later entry is tried only after the one before it fails. */
const SWIFT_LADDER = [
  {
    // A mixture of experts: 35B weights, about 3B used per token, so it answers several times
    // faster than the dense 27B. Needs 32 GB: about 20 GB in memory with the 32K context.
    tag: "hf.co/unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ4_XS",
    alias: "yourai-default",
    name: "Qwen 3.6 35B-A3B",
    sizeGB: 17.7,
    note: "Your AI's model on computers with 32 GB or more. About 20 GB in memory.",
    quant: "IQ4_XS",
    minMemoryGB: 32,
  },
  {
    // 4-bit: answers cleanly and calls tools properly. The 2-bit build below sometimes wrote tool
    // calls out as raw text, so it is only for computers without the memory for this one.
    tag: "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:Q4_K_M",
    alias: "swift-1.5-27b",
    name: "Swift 1.5 27B",
    sizeGB: 18,
    note: "Your AI's model. About 20 GB in memory.",
    quant: "Q4_K_M",
    minMemoryGB: 24,
  },
  {
    tag: "hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS",
    alias: "swift-1.5-27b",
    name: "Swift 1.5 27B (compact)",
    sizeGB: 8.9,
    note: "For computers with 16 to 24 GB of memory. About 11 GB in memory.",
    quant: "IQ2_XXS",
    minMemoryGB: 16,
  },
] as const satisfies readonly SwiftModel[];
export const SWIFT_MODELS: readonly SwiftModel[] = SWIFT_LADDER;

/** The best model this computer has the memory for (16 GB machines report a little less). */
export function defaultModelFor(memoryBytes: number): SwiftModel {
  return (
    SWIFT_LADDER.find((model) => memoryBytes >= (model.minMemoryGB - 1) * 1024 ** 3) ??
    SWIFT_LADDER[2]
  );
}
/**
 * The model Your AI uses unless the person picks another: Qwen 3.6 35B-A3B on 32 GB or more, the
 * 27B at Q4_K_M on 24 to 32 GB, the compact IQ2_XXS build on 16 to 24 GB.
 */
export const DEFAULT_MODEL: SwiftModel = defaultModelFor(totalMemory());
/** Answers greetings and small talk in about a second while a 27B handles real work. */
/** Gente uses one model for everything (Santi's decision); kept for older saved settings. */
export const QUICK_MODEL: SwiftModel | null = null;

/** Context Gente asks Ollama to load. Bots send long tool lists, so the 4K default is too small. */
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
  /** Set when Gente moved to a smaller Swift after a real failure. */
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
  /** True when the person picked this model; false when Gente chose the default. */
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
export function swiftServerEnv(
  saved: SavedBrain | null,
  stackDir?: string,
): Record<string, string> {
  if (saved === null) return {};
  const installed = [saved.alias, ...saved.installed.filter((id) => id !== saved.alias)];
  return {
    RAKAZO_LOCAL_MODELS: installed.join(","),
    RAKAZO_LOCAL_MODELS_URL: `${OLLAMA_URL}/v1`,
    RAKAZO_LOCAL_CONTEXT_WINDOW: String(SWIFT_CONTEXT),
    RAKAZO_LOCAL_MAX_TOKENS: "8192",
    // Cloud GPU writes a larger window here while it is on (cloud-gpu/cloud-gpu-toggle.ts).
    ...(stackDir ? { RAKAZO_LOCAL_LIMITS_FILE: limitsFilePath(stackDir) } : {}),
    RAKAZO_LOCAL_REASONING_MODELS: installed.join(","),
    RAKAZO_LOCAL_VISION_MODELS: (saved.vision ?? []).join(","),
    BURROW_FAST_CHAT: "on",
    // The model server sends a tool call only when it is complete; writing a file can take a
    // few silent minutes on this Mac, which is not a stall.
    MODEL_STREAM_IDLE_TIMEOUT_MS: "600000",
    // The Link agent wallet: bots ask for a purchase (amount, merchant, reason), the person
    // approves each one in Link, and Link issues a one-time card or pay token. No card is stored.
    PAYMENT_WALLET_PROVIDER: "link",
    ...(saved.chatAlias && saved.chatAlias !== saved.alias
      ? { BURROW_CHAT_MODEL: saved.chatAlias }
      : {}),
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
  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    "Programs",
    "Ollama",
  );
}

/**
 * Settings Gente wants from the model server: two requests at once (a chat and a routine) and
 * the model kept in memory so replies never wait for a reload.
 */
export const OLLAMA_SETTINGS = {
  OLLAMA_NUM_PARALLEL: "2",
  OLLAMA_KEEP_ALIVE: "-1",
  // Gente: a smaller, faster prompt cache. Without these each reply re-reads more slowly.
  OLLAMA_FLASH_ATTENTION: "1",
  OLLAMA_KV_CACHE_TYPE: "q8_0",
} as const;

/** Homebrew's background service for Ollama, when the person set one up. */
const BREW_OLLAMA_PLIST = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  "sh.brew.ollama.plist",
);

/**
 * Starts Homebrew's Ollama service when one is set up, so there is only ever one Ollama and it
 * keeps the settings the person gave it. Returns false when there is no such service.
 */
function startBrewOllamaService(): boolean {
  if (process.platform !== "darwin" || !existsSync(BREW_OLLAMA_PLIST)) return false;
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  const domain = `gui/${uid}`;
  // Loads it if it is not loaded yet (an error here just means it already is), then starts it.
  spawn("/bin/launchctl", ["bootstrap", domain, BREW_OLLAMA_PLIST], { stdio: "ignore" }).unref();
  spawn("/bin/launchctl", ["kickstart", `${domain}/sh.brew.ollama`], { stdio: "ignore" }).unref();
  return true;
}

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
    // The tray app reads the user's environment, so keep Gente's settings there too.
    for (const [name, value] of Object.entries(OLLAMA_SETTINGS)) {
      if (process.env[name] === undefined)
        spawn("setx", [name, value], { stdio: "ignore", windowsHide: true }).unref();
    }
    spawn(cli, ["serve"], { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
  } else if (startBrewOllamaService()) {
    // Homebrew's service runs it; starting another would fight it for the port.
  } else if (appPath !== null) {
    // The Mac app keeps its own settings; Gente does not change a person's Ollama app.
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

/** The quantization of the weights an Ollama name points at, or null when unknown. */
async function aliasQuant(name: string): Promise<string | null> {
  try {
    const res = await ollama(
      "/api/show",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name }),
      },
      15_000,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { details?: { quantization_level?: string } };
    return body.details?.quantization_level ?? null;
  } catch {
    return null;
  }
}

function hasTag(tags: string[], tag: string) {
  return tags.some((name) => name === tag || name === `${tag}:latest`);
}

/**
 * Sends the last chat's stable prefix (saved by the server as `data/burrow-warm.json`) to the
 * model with a one-token reply, so the first message after Gente opens finds it already read.
 */
let prewarming: Promise<boolean> | null = null;
let taskWarmScheduled = false;

/**
 * Gets the model ready as Your AI opens: loads it into memory first (an empty prompt, kept loaded),
 * then reads the small-talk prompt. Runs once at a time: it is asked for both when the model
 * server starts and when the workspace is ready, and two at once made the first "hey" wait
 * behind both (26.9 s on Santi's Mac).
 */
export function prewarmSwift(stackDirectory: string): Promise<boolean> {
  prewarming ??= warmUp(stackDirectory).finally(() => {
    prewarming = null;
  });
  return prewarming;
}

async function warmUp(stackDirectory: string): Promise<boolean> {
  const saved = await readSavedBrain(stackDirectory);
  if (saved === null) return false;
  // Load the weights before anything reads a prompt: a message that arrives meanwhile waits only
  // for the load, not behind a prompt too. keep_alive -1 keeps them in memory while Your AI is used.
  await ollama(
    "/api/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: saved.chatAlias ?? saved.alias,
        prompt: "",
        keep_alive: -1,
        stream: false,
      }),
    },
    5 * 60_000,
  ).catch(() => undefined);
  // Only the short small-talk prompt, on the quick model: it reads in about a second, so the first
  // "hey" after launch finds it ready. Warming the long task prompt here would hold the model
  // server for minutes and make that first "hey" wait behind it.
  const model = saved.chatAlias ?? saved.alias;
  try {
    const prefix = JSON.parse(
      await readFile(path.join(stackDirectory, "data", "burrow-warm-chat.json"), "utf8"),
    ) as { messages?: unknown[] };
    const body =
      Array.isArray(prefix.messages) && prefix.messages.length > 0
        ? {
            ...prefix,
            messages: sanitizeChatMessages(prefix.messages as WireMessage[]),
            stream_options: undefined,
          }
        : { messages: [{ role: "user", content: "hi" }] };
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        model,
        stream: false,
        max_completion_tokens: 1,
        max_tokens: 1,
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    await res.text();
    // QA-022: then the long task prompt (system prompt plus about 23 tool schemas, ~10k tokens),
    // so the first real question after launch also finds its prefix cached. It runs after the
    // small-talk warm-up, in the background, and never delays a reply.
    // Measured on Santi's Mac: warming it right away made the first "hey" after launch wait 6 s
    // behind it, so it waits two minutes, when the person is most likely reading.
    if (res.ok && !taskWarmScheduled) {
      taskWarmScheduled = true;
      setTimeout(() => void warmTaskPrefix(stackDirectory, model), 120_000).unref();
    }
    return res.ok;
  } catch {
    // No chat yet, or the model server is busy: the first reply reads the prompt instead.
    return false;
  }
}

async function warmTaskPrefix(stackDirectory: string, model: string): Promise<void> {
  try {
    const prefix = JSON.parse(
      await readFile(path.join(stackDirectory, "data", "burrow-warm.json"), "utf8"),
    ) as { messages?: unknown[] };
    if (!Array.isArray(prefix.messages) || prefix.messages.length === 0) return;
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...prefix,
        // A prefix saved by an older build can end in a tool call without its result.
        messages: sanitizeChatMessages(prefix.messages as WireMessage[]),
        stream_options: undefined,
        model,
        stream: false,
        max_completion_tokens: 1,
        max_tokens: 1,
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    await res.text();
  } catch {
    // Best effort only.
  }
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
 * Gente 0.1 builds made the 27B model the default. On launch, move a default that Gente chose
 * (not one the person picked) to the fast default when that model is already downloaded, and
 * unload the 27B. Returns true when the saved model changed, so the workspace restarts on it.
 */
export async function moveToFastDefault(stackDirectory: string): Promise<boolean> {
  const saved = await readSavedBrain(stackDirectory);
  if (saved === null || (saved.alias === DEFAULT_MODEL.alias && !saved.chatAlias)) return false;
  // A model the person picked stays.
  if (saved.userPicked) return false;
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
    const chatAlias = undefined;
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

  private async logDetail(line: string) {
    try {
      await mkdir(path.join(this.stackDirectory, "logs"), { recursive: true });
      await appendFile(
        path.join(this.stackDirectory, "logs", "setup.log"),
        `${new Date().toISOString()} ${line}\n`,
      );
    } catch {
      // Never let logging fail setup.
    }
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
    // A friendly check before anything downloads: the 27B needs about 11 GB on its own.
    if (totalMemory() < MIN_MEMORY_BYTES) {
      this.set({ phase: "failed", message: CALM.smallComputer });
      return;
    }
    if (!(await ollamaRunning())) {
      // Beginners never see an extra step: the model runner installs itself silently, and an
      // existing install is reused. `installOllama: false` only exists for tests.
      if (!ollamaInstalled()) {
        if (options.installOllama === false) {
          this.set({ phase: "ollama-missing" });
          return;
        }
        try {
          await this.installOllama();
        } catch (error) {
          await this.logDetail(`Ollama install failed: ${errorText(error)}`);
          this.set({ phase: "failed", message: CALM.install });
          return;
        }
      }
      this.set({ phase: "starting-ollama", completedBytes: 0, totalBytes: 0 });
      if (!(await startOllama())) {
        await this.logDetail("Ollama did not start");
        this.set({ phase: "failed", message: CALM.ollama });
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
        await this.prepare(model, { mayMoveDown: i === picked || i === kept || failed.size > 0 });
        // A 27B gets a quick partner for small talk; shown to the person as one assistant.
        let chatAlias: string | undefined;
        if (QUICK_MODEL && model.alias !== QUICK_MODEL.alias) {
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
        await this.logDetail(`${model.name}: ${errorText(error)}`);
        // A download that keeps failing is a network problem, not a reason to pick a smaller model.
        if (error instanceof NeedsAction) {
          this.set({ phase: "failed", message: error.message });
          return;
        }
        firstFailure ??= model.name;
        failed.add(model.alias);
        this.set({ message: "" });
      }
    }
    this.set({ phase: "failed", message: CALM.memory });
  }

  /** Pulls (resumable), names it with a larger context, and loads it once to prove it runs. */
  private async prepare(model: SwiftModel, options: { mayMoveDown?: boolean } = {}) {
    let tags = await installedTags();
    if (!hasTag(tags, model.tag)) {
      this.set({ phase: "pulling" });
      await ensureFreeSpace(model);
      // Ollama resumes a pull where it stopped, so retrying costs nothing already downloaded.
      for (let attempt = 0; ; attempt++) {
        try {
          await this.pull(model.tag);
          break;
        } catch (error) {
          await this.logDetail(`pull ${model.tag} attempt ${attempt + 1}: ${errorText(error)}`);
          if (attempt >= PULL_RETRY_MS.length) throw new NeedsAction(CALM.offline);
          await new Promise((resolve) => setTimeout(resolve, PULL_RETRY_MS[attempt]));
        }
      }
      tags = await installedTags();
    }
    // The alias names the weights it was made from. Move it to this model's weights when it points
    // at others: always up to a better build, but down only when the person picked the smaller
    // one or the better one failed to load here (never on a plain launch).
    const current = hasTag(tags, model.alias) ? await aliasQuant(model.alias) : null;
    // Better means earlier among the builds served under this same name.
    const builds = SWIFT_MODELS.filter((m) => m.alias === model.alias);
    const better = (quant: string) => builds.findIndex((m) => m.quant === quant);
    const movesDown =
      current !== null && better(current) >= 0 && better(current) < better(model.quant);
    const repoint =
      current !== null && current !== model.quant && (!movesDown || options.mayMoveDown);
    if (!hasTag(tags, model.alias) || repoint) {
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
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (Date.now() - lastPush > 250) {
        lastPush = Date.now();
        this.set({ completedBytes: completed, totalBytes: total });
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
    const appsDir = path.join(os.homedir(), "Applications");
    await mkdir(appsDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/ditto", ["-x", "-k", tmp, appsDir], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)),
      );
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
async function downloadTo(
  url: string,
  file: string,
  onBytes: (done: number, total: number) => void,
) {
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

/** Calm words for the few things a person may need to do; details go to logs/setup.log. */
export const CALM = {
  offline:
    "Your AI needs the internet to finish getting ready. It will pick up where it left off. Press Try again when you're back online.",
  install: "Your AI couldn't finish getting ready just now. Press Try again in a moment.",
  ollama: "Your AI is taking a moment to start. Press Try again.",
  memory:
    "This computer is short on free memory right now. Close a few apps, then press Try again.",
  smallComputer:
    "Your AI needs a computer with at least 16 GB of memory. This one has less, so Your AI can't run its model here.",
  space: (gb: number) =>
    `Your AI needs about ${gb} GB of free disk space. Free up some space, then press Try again.`,
} as const;
/**
 * The computer's memory. CI runners with less than 16 GB (the 7 GB macOS arm64 runner) set
 * GENTE_E2E_MEMORY_GB to get past the check against the stand-in model server.
 */
export function totalMemory(env = process.env): number {
  const forced = Number(env.GENTE_E2E_MEMORY_GB);
  return Number.isFinite(forced) && forced > 0 ? forced * 1024 ** 3 : os.totalmem();
}

/** 16 GB machines report a little less than 16 GiB; allow for that. */
export const MIN_MEMORY_BYTES = 15 * 1024 ** 3;

/** Pauses between download retries; exported so tests can shorten them. */
export const PULL_RETRY_MS: number[] = [2_000, 5_000, 15_000, 30_000];

/** A failure only the person can fix; its message is already calm. */
export class NeedsAction extends Error {}

async function ensureFreeSpace(model: SwiftModel) {
  try {
    const stats = await statfs(os.homedir());
    const free = Number(stats.bavail) * Number(stats.bsize);
    const needed = (model.sizeGB + 2) * 1e9;
    if (free < needed) throw new NeedsAction(CALM.space(Math.ceil(model.sizeGB + 2)));
  } catch (error) {
    if (error instanceof NeedsAction) throw error;
    // Can't read the disk size: let the download try.
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

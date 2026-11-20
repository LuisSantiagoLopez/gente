// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The real environment the self-healing catalog runs against in the desktop app: what it reads
// (all local and cheap; no model requests) and what each repair does.
import { existsSync, readFileSync } from "node:fs";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, session } from "electron";
import { accountToken, isSignedIn } from "../burrow/account.js";
import { OLLAMA_URL, readSavedBrain, startOllama } from "../burrow/brain.js";
import { rebuildBrain } from "../burrow/brain-ipc.js";
import { CONNECTED_APPS_UNCONFIGURED } from "@rakazo/adapters/desktop-server-env";
import { COMPUTER_CHOICE_FILE, readComputerChoice } from "../burrow/service-keys.js";
import { GENTE_CLOUD_URL } from "../burrow/gente-cloud.js";
import { desktop } from "../desktop-state.js";
import { findMissingAppFiles } from "../support/app-files.js";
import {
  freeDiskBytes,
  ollamaModelError,
  ollamaUp,
  portAnswers,
  portHeldByOther,
} from "../support/probes.js";
import { NATIVE_PORTS_FILE } from "../this-computer/native-stack.js";
import { WINDOWS_PORTS_FILE } from "../this-computer/windows-stack.js";
import type { HealEnv, LogSignal } from "./catalog.js";

/** What the model router exposes for self-heal (see burrow/model-router.ts). */
export type RouterHandle = {
  localWaitMs: () => number | null;
  /** Kept optional for older routers; the AI always runs on this computer. */
  refresh?: () => Promise<void>;
};

type ServiceControl = {
  serviceAlive(name: string): boolean | null;
  restartService(name: string): Promise<boolean>;
};

const SIGNALS: [LogSignal, RegExp][] = [
  ["computer-template-missing", /template\b[^\n]*\bnot found|template_not_found/i],
  ["apps-not-configured", CONNECTED_APPS_UNCONFIGURED],
  ["media-balance-empty", /fal[^\n]*balance|balance_exhausted/i],
  ["sign-in-rejected", /gente cloud[^\n]*\b401\b/i],
];
const LOGS = ["api.log", "worker.log"];

export function desktopHealEnv(input: {
  stackDir: string;
  router: () => RouterHandle | null;
  notify: (failureId: string) => Promise<void>;
}): HealEnv {
  const { stackDir } = input;
  const logDir = path.join(stackDir, "logs");
  const offsets = new Map<string, number>();
  const stack = () => desktop.localStack as unknown as Partial<ServiceControl> | undefined;
  // The plain-process stack writes its ports to one file on Mac and another on Windows.
  const ports = (): { api?: number; postgres?: number } => {
    for (const file of [NATIVE_PORTS_FILE, WINDOWS_PORTS_FILE]) {
      try {
        return JSON.parse(readFileSync(path.join(stackDir, file), "utf8"));
      } catch {
        // Not this platform's file.
      }
    }
    return {};
  };
  const ready = () => desktop.localStack?.state().phase === "ready";

  return {
    ollamaUp: () => ollamaUp(OLLAMA_URL),
    modelState: async () => {
      const alias = (await readSavedBrain(stackDir))?.alias;
      if (!alias || !(await ollamaUp(OLLAMA_URL))) return "unknown";
      const error = await ollamaModelError(OLLAMA_URL, alias).catch(() => null);
      if (error === null) return "ready";
      return /not found/i.test(error) ? "missing" : "corrupt";
    },
    localLatencyMs: () => input.router()?.localWaitMs() ?? null,
    // The workspace's own parts are only judged once it has started; starting is setup's job.
    postgresUp: async () => {
      const port = ports().postgres;
      return !ready() || port === undefined || (await portAnswers(port));
    },
    apiUp: async () => {
      const port = ports().api;
      if (!ready() || port === undefined) return true;
      return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_500) })
        .then((r) => r.ok)
        .catch(() => false);
    },
    worker: async () => {
      if (!ready()) return "unknown";
      const alive = stack()?.serviceAlive?.("worker");
      // A worker that stops taking jobs exits by itself (apps/worker job-pickup watchdog), so
      // "not alive" covers the silent stall too.
      return alive === null || alive === undefined ? "unknown" : alive ? "ok" : "down";
    },
    portHeldByOther: async () => {
      const port = ports().api;
      return ready() ? false : port !== undefined && (await portHeldByOther(port));
    },
    missingAppFiles: async () => {
      const serverDir = app.isPackaged ? path.join(process.resourcesPath, "rakazo-server") : null;
      let manifest: { entrypoints?: Record<string, string> } | null = null;
      if (serverDir && existsSync(path.join(serverDir, "manifest.json")))
        manifest = JSON.parse(readFileSync(path.join(serverDir, "manifest.json"), "utf8"));
      return findMissingAppFiles({
        serverDir: manifest ? serverDir : null,
        manifest,
        exists: existsSync,
        serviceLogLines: [],
      });
    },
    freeDiskBytes: () => freeDiskBytes(os.homedir()),
    logSignals: async () => {
      const found = new Set<LogSignal>();
      for (const name of LOGS) {
        const file = path.join(logDir, name);
        const size = (await stat(file).catch(() => null))?.size ?? 0;
        let from = offsets.get(name);
        // First read starts at the end: old lines were from before this launch.
        if (from === undefined || from > size) from = size;
        offsets.set(name, size);
        if (size <= from) continue;
        const handle = await open(file, "r");
        try {
          const length = Math.min(size - from, 256 * 1024);
          const { buffer } = await handle.read(Buffer.alloc(length), 0, length, size - length);
          const text = buffer.toString("utf8");
          for (const [signal, pattern] of SIGNALS) if (pattern.test(text)) found.add(signal);
        } finally {
          await handle.close();
        }
      }
      return found;
    },
    signIn: async () => {
      if (!isSignedIn()) return "signed-out";
      return (await accountToken().catch(() => null)) ? "ok" : "expired";
    },
    relayUp: async () => {
      if (!isSignedIn()) return null;
      return fetch(`${GENTE_CLOUD_URL}/v1/health`, { signal: AbortSignal.timeout(3_000) })
        .then((r) => r.ok)
        .catch(() => false);
    },
    retryRequest: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    computerIsLocal: async () => (await readComputerChoice(stackDir)) === "local",
    retryOllama: async () => {
      await ollamaUp(OLLAMA_URL);
    },
    startOllama: async () => {
      await startOllama();
    },
    restartService: async (name) => {
      if (name === "relay") {
        // The relay lives in this process; reconnecting means getting a fresh sign-in.
        await accountToken().catch(() => null);
        return;
      }
      const done = await stack()?.restartService?.(name);
      if (!done) {
        await desktop.localStack.stop().catch(() => undefined);
        await desktop.localStack.start().catch(() => undefined);
      }
    },
    resetStack: async () => {
      await desktop.localStack.stop().catch(() => undefined);
      await desktop.localStack.start().catch(() => undefined);
    },
    redownloadModel: async () => {
      const saved = await readSavedBrain(stackDir);
      for (const model of saved ? [saved.alias, saved.model] : [])
        await fetch(`${OLLAMA_URL}/api/delete`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
        }).catch(() => undefined);
      await rebuildBrain();
    },
    clearCaches: async () => {
      await session.defaultSession.clearCache();
      for (const file of [
        "api.previous.log",
        "worker.previous.log",
        "web.previous.log",
        "postgres.previous.log",
      ])
        await rm(path.join(logDir, file), { force: true });
    },
    refreshSignIn: async () => {
      await accountToken().catch(() => null);
    },
    useLocalComputer: async () => {
      if ((await readComputerChoice(stackDir)) === "local") return;
      await writeFile(path.join(stackDir, COMPUTER_CHOICE_FILE), "local\n");
      // The server reads the choice when it starts.
      await stack()?.restartService?.("api");
      await stack()?.restartService?.("worker");
    },
    notifyCloud: (failureId) => input.notify(failureId),
  };
}

/** The timeline file, newest last; kept short. */
export async function readTimelineFile(file: string) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).slice(-200);
}

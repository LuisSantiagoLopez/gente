// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// The "Cloud GPU" switch. Saved in the app's data folder (`cloud-gpu`, "on" or absent). While it
// is on, model-router.ts sends chats to a rented GPU and the server's runs get the cloud's larger
// context window through the limits file read by packages/adapters/.../pi-local-limits.ts.
// Turning it off stops every GPU. Who calls it: main.ts (create, quit) and cloud-gpu-ipc.ts.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "../setup/setup-store.js";
import { CLOUD_LIMITS } from "./cloud-gpu-config.js";
import type { CloudMode } from "./cloud-gpu-route.js";
import type { CloudGpuSessions, CloudGpuStatus } from "./cloud-gpu-sessions.js";
import type { SharedGpu } from "./cloud-gpu-shared.js";
import type { WarmPool } from "./cloud-gpu-warm.js";

export const CLOUD_GPU_FILE = "cloud-gpu";
export const LIMITS_FILE = "cloud-gpu-limits.json";
/** "dedicated" when the person wants a GPU of their own per chat; absent means shared. */
export const MODE_FILE = "cloud-gpu-mode";

export type CloudGpuState = {
  /** A key is in the Keychain, so this Mac can rent a GPU. */
  available: boolean;
  on: boolean;
  /** Shared: one warm GPU for many chats (default). Dedicated: a GPU of its own per chat. */
  mode: CloudMode;
  status: CloudGpuStatus;
  dollarsPerHour: number;
};

export interface ToggleDeps {
  userDataDir: string;
  /** The server's folder; the limits file goes here (RAKAZO_LOCAL_LIMITS_FILE). */
  stackDir: string;
  sessions: CloudGpuSessions;
  shared?: SharedGpu;
  hasKey: () => Promise<boolean>;
  /** The spare GPU kept ready while the person is active (cloud-gpu-warm.ts). */
  warm?: WarmPool;
  write?: (file: string, text: string) => Promise<void>;
  remove?: (file: string) => Promise<void>;
}

export function limitsFilePath(stackDir: string): string {
  return path.join(stackDir, LIMITS_FILE);
}

export function createCloudGpuToggle(deps: ToggleDeps) {
  const file = path.join(deps.userDataDir, CLOUD_GPU_FILE);
  const limits = limitsFilePath(deps.stackDir);
  const write = deps.write ?? writePrivateFile;
  const remove = deps.remove ?? ((target: string) => rm(target, { force: true }));
  let on = false;
  try {
    on = readFileSync(file, "utf8").trim() === "on";
  } catch {
    on = false;
  }
  let available = false;
  const modeFile = path.join(deps.userDataDir, MODE_FILE);
  let mode: CloudMode = "shared";
  try {
    if (readFileSync(modeFile, "utf8").trim() === "dedicated") mode = "dedicated";
  } catch {
    mode = "shared";
  }
  const dedicated = () => mode === "dedicated" || !deps.shared;

  /** Runs that start now use the cloud window; runs already going keep theirs. */
  async function syncLimits(cloud: boolean) {
    if (cloud) await write(limits, JSON.stringify(CLOUD_LIMITS));
    else await remove(limits);
  }

  return {
    /** Reads the Keychain once and puts the limits file in step with the switch. */
    async init() {
      available = await deps.hasKey();
      await syncLimits(on && available).catch(() => undefined);
      // Opening the app with Cloud GPU on readies a GPU before the first message.
      if (on && available) deps.warm?.activity();
    },
    active: () => on && available,
    async set(next: unknown): Promise<CloudGpuState> {
      if (typeof next !== "boolean") return this.state();
      available = await deps.hasKey();
      on = next && available;
      if (on) await write(file, "on");
      else await remove(file);
      await syncLimits(on);
      // A GPU takes about 20 s to start, so it starts now, while the person writes.
      if (on) {
        deps.warm?.activity();
        if (dedicated()) deps.sessions.prewarm();
      } else await Promise.all([deps.sessions.stopAll(), deps.warm?.off()]);
      return this.state();
    },
    /** The cloud failed: this Mac answers, with its own window, until the cloud is back. */
    async fellBack(message: string) {
      deps.sessions.noteFallback(message);
      await syncLimits(false).catch(() => undefined);
    },
    async recovered() {
      if (on && available) await syncLimits(true).catch(() => undefined);
    },
    prewarm() {
      if (!on || !available) return;
      deps.warm?.activity();
      if (dedicated()) deps.sessions.prewarm();
    },
    mode: () => mode,
    /** Shared or dedicated. Switching lets go of any dedicated GPUs. */
    async setMode(next: unknown): Promise<CloudGpuState> {
      if (next !== "shared" && next !== "dedicated") return this.state();
      mode = next;
      if (mode === "dedicated") await write(modeFile, "dedicated");
      else await remove(modeFile);
      if (mode === "shared") await deps.sessions.stopAll();
      return this.state();
    },
    state(): CloudGpuState {
      return {
        available,
        on: on && available,
        mode,
        status: !on
          ? deps.sessions.status()
          : dedicated()
            ? deps.sessions.status()
            : (deps.shared as SharedGpu).status(),
        dollarsPerHour: deps.sessions.dollarsPerHour(),
      };
    },
    /** App quit: every GPU is let go before the app exits. */
    shutdown: () => Promise.all([deps.sessions.stopAll(), deps.warm?.off()]).then(() => undefined),
  };
}

export type CloudGpuToggle = ReturnType<typeof createCloudGpuToggle>;

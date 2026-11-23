// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The local model's context window and output limit, which can change while the server runs.
// With Cloud GPU on, the desktop app writes a small JSON file (RAKAZO_LOCAL_LIMITS_FILE) with a
// much larger window, because a rented GPU is not limited by this Mac's memory. Each run reads
// the limits when it starts. Who calls it: pi-local-provider.ts (localModel). Who writes the file:
// apps/desktop/src/main/cloud-gpu/cloud-gpu-toggle.ts.
import { readFileSync, statSync } from "node:fs";

export const LOCAL_LIMITS_FILE_ENV = "RAKAZO_LOCAL_LIMITS_FILE";

export type LocalLimits = { contextWindow?: number; maxTokens?: number };

let cached: { path: string; mtimeMs: number; size: number; limits: LocalLimits } | null = null;

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** The limits in the file, or nothing when there is no file or it is unreadable. */
export function readLocalLimits(env: NodeJS.ProcessEnv = process.env): LocalLimits {
  const file = env[LOCAL_LIMITS_FILE_ENV]?.trim();
  if (!file) return {};
  try {
    const stat = statSync(file);
    if (
      cached &&
      cached.path === file &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    )
      return cached.limits;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const limits: LocalLimits = {
      contextWindow: positive(parsed.contextWindow),
      maxTokens: positive(parsed.maxTokens),
    };
    cached = { path: file, mtimeMs: stat.mtimeMs, size: stat.size, limits };
    return limits;
  } catch {
    return {};
  }
}

/**
 * Makes `contextWindow` and `maxTokens` read the file each time they are read, falling back to
 * the limits set when the server started. A copy of the model taken for a run keeps that run's
 * values, so a run never changes limits halfway.
 */
export function withLiveLimits<T extends { contextWindow: number; maxTokens: number }>(
  model: T,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const base = { contextWindow: model.contextWindow, maxTokens: model.maxTokens };
  if (!env[LOCAL_LIMITS_FILE_ENV]?.trim()) return model;
  // A value set on the model later (the runtime adjusts limits) wins over the file.
  const set: { contextWindow?: number; maxTokens?: number } = {};
  for (const key of ["contextWindow", "maxTokens"] as const) {
    Object.defineProperty(model, key, {
      enumerable: true,
      configurable: true,
      get: () => set[key] ?? readLocalLimits(env)[key] ?? base[key],
      set: (value: number) => {
        set[key] = value;
      },
    });
  }
  return model;
}

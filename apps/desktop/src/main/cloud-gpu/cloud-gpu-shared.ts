// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Shared mode, the default: every chat goes to one warm GPU that answers many chats at once
// (infra/cloud-gpu/shared_app.py). Nothing to start or stop per chat. Each chat gets its own
// `cache_salt`, so no chat can reuse (or time) another chat's prompt cache.
// It offers the same calls as cloud-gpu-sessions.ts, so cloud-gpu-route.ts treats both alike.
// Who calls it: cloud-gpu-route.ts and cloud-gpu-toggle.ts (status).
import { createHash, randomBytes } from "node:crypto";
import type { CloudGpuStatus, CloudSession } from "./cloud-gpu-sessions.js";

export const SHARED_GPU_LABEL = "H100 · shared";

export function createSharedGpu(input: { url: string; now?: () => number }) {
  const now = input.now ?? Date.now;
  // New on every launch: a salt never outlives the app, like the cache it protects.
  const launchSecret = randomBytes(32).toString("hex");
  let waitingSince: number | null = null;
  let answeredAt: number | null = null;

  return {
    async session(_key: string): Promise<CloudSession> {
      waitingSince ??= now();
      return { url: input.url, token: "", gpu: SHARED_GPU_LABEL, startMs: 0 };
    },
    /** The GPU sent its first byte: it is warm. */
    answered() {
      waitingSince = null;
      answeredAt = now();
    },
    done(_key: string, _finish: string) {},
    failed(_key: string) {
      waitingSince = null;
    },
    /** A per-chat salt for vLLM's prompt cache. */
    salt: (key: string) => createHash("sha256").update(`${launchSecret}:${key}`).digest("hex"),
    status(): CloudGpuStatus {
      // A warm GPU answers in under a second; a longer wait is a cold start worth showing.
      if (waitingSince !== null && now() - waitingSince > 800)
        return { phase: "starting", since: waitingSince };
      return { phase: "on", gpu: SHARED_GPU_LABEL, startMs: 0, sessions: answeredAt ? 1 : 0 };
    },
  };
}

export type SharedGpu = ReturnType<typeof createSharedGpu>;

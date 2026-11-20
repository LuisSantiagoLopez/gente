// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The "Where the AI runs" choice: Fast (Gente Cloud) or Private (this computer). Saved in the
// app's data folder. Until the person picks, paid plans get Fast and everyone else Private.
import { readFileSync } from "node:fs";
import path from "node:path";
import { writePrivateFile } from "../setup/setup-store.js";
import type { AiMode } from "./model-router.js";

const FILE = "ai-mode";

export function createAiMode(userDataDir: string, paid: () => boolean) {
  const file = path.join(userDataDir, FILE);
  let picked: AiMode | null = null;
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (raw === "fast" || raw === "private") picked = raw;
  } catch {
    picked = null;
  }
  return {
    current: (): AiMode => picked ?? (paid() ? "fast" : "private"),
    picked: () => picked,
    async set(mode: unknown): Promise<AiMode> {
      if (mode !== "fast" && mode !== "private") return picked ?? (paid() ? "fast" : "private");
      picked = mode;
      await writePrivateFile(file, mode);
      return mode;
    },
  };
}

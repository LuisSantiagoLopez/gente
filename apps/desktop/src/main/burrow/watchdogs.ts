// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Two quiet guards, checked every 20 seconds: Ollama is restarted if it stopped, and a workspace
// that stopped answering (a crashed database, a deleted server folder) is restarted from scratch,
// which re-unpacks the server that ships inside the app.
import type { StackController } from "../this-computer/local-stack.js";
import { ollamaInstalled, ollamaRunning, startOllama } from "./brain.js";

const INTERVAL_MS = 20_000;

export function startWatchdogs(stack: () => StackController, interval = INTERVAL_MS) {
  let unhealthy = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (ollamaInstalled() && !(await ollamaRunning())) await startOllama();
      const current = stack();
      if (current.state().phase === "ready") {
        unhealthy = (await current.matchesDesiredStack().catch(() => false)) ? 0 : unhealthy + 1;
        if (unhealthy >= 2) {
          unhealthy = 0;
          await current.stop().catch(() => undefined);
          await current.start().catch(() => undefined);
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  return () => clearInterval(timer);
}

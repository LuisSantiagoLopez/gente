// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// One repair of the workspace at a time on this computer. Self-healing and the support monitor
// both restart services; two at once (a restart during a reset) left an old API running beside
// the new one, and the extra connections tripped the next repair.

let held: Promise<unknown> | null = null;

/** Runs `work` unless another repair holds the lock; then returns null without running it. */
export function exclusiveRepair<T>(work: () => Promise<T>): Promise<T | null> {
  if (held !== null) return Promise.resolve(null);
  const running = work().finally(() => {
    if (held === running) held = null;
  });
  held = running;
  return running;
}

/** True while a repair holds the lock. */
export function repairRunning(): boolean {
  return held !== null;
}

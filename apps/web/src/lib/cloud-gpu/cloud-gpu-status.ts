// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// The words for the Cloud GPU status line and the privacy note, from the desktop app's state.
// Pure, so it is tested without a window. Who calls it: use-cloud-gpu.ts and CloudGpuToggle.tsx.
import type { GenteCloudGpuState } from "@rakazo/contracts";

export type CloudGpuLine = { text: string; tone: "busy" | "on" | "warn" } | null;

/** "Starting cloud GPU… 2.1 s", then "Cloud GPU · H100", nothing once it is stopped. */
export function cloudGpuLine(state: GenteCloudGpuState | null, now: number): CloudGpuLine {
  if (!state) return null;
  const status = state.status;
  if (status.phase === "starting") {
    const seconds = Math.max(0, (now - status.since) / 1000).toFixed(1);
    return { text: `Starting cloud GPU… ${seconds} s`, tone: "busy" };
  }
  if (status.phase === "on") {
    return { text: `Cloud GPU · ${status.gpu}`, tone: "on" };
  }
  if (status.phase === "fallback") return { text: status.message, tone: "warn" };
  return null;
}

/** Said plainly while the switch is on; the "stays on this Mac" promise does not hold then. */
export const CLOUD_PRIVACY_NOTE =
  "Cloud GPU is on: your messages go to a rented GPU used only by this chat, and it is deleted after.";

/** Poll fast while something is changing, slowly otherwise. */
export function pollDelay(state: GenteCloudGpuState | null): number {
  if (!state?.on) return 5000;
  return state.status.phase === "starting" ? 100 : 1000;
}

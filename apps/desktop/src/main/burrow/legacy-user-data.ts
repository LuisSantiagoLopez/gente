// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

/** Earlier names of this app, newest first. Their data folder is reused as is. */
export const LEGACY_APP_NAMES = ["Gente", "Burrow"] as const;

/** The folder to use: the current one if it exists, else the newest legacy one that does. */
export function pickUserData(current: string, exists: (dir: string) => boolean): string {
  // Chromium may create the current folder before this runs, so look for a workspace in it.
  if (exists(path.join(current, "stack"))) return current;
  for (const name of LEGACY_APP_NAMES) {
    const legacy = path.join(path.dirname(current), name);
    if (exists(path.join(legacy, "stack"))) return legacy;
  }
  return current;
}

export function useLegacyUserData() {
  // Test and performance runs choose their own folder.
  if (process.env.RAKAZO_PERFORMANCE_USER_DATA) return;
  const current = app.getPath("userData");
  const chosen = pickUserData(current, existsSync);
  if (chosen !== current) app.setPath("userData", chosen);
}

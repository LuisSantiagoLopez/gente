// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Finds the running .app bundle and says whether it can be replaced in place:
//   - "translocated" (macOS runs a quarantined download from a random read-only path) or
//     "disk-image" (run straight from the DMG): the person must move it to Applications first;
//   - "needs-admin": the folder is not writable, so the swap runs behind the macOS admin prompt;
//   - "ok": the swap runs as the person.
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

export type InstallLocation =
  | { kind: "ok"; bundle: string }
  | { kind: "needs-admin"; bundle: string }
  | { kind: "translocated"; bundle: string }
  | { kind: "disk-image"; bundle: string };

/** /Applications/Your AI.app from /Applications/Your AI.app/Contents/MacOS/Your AI. */
export function bundleFromExecPath(execPath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const at = execPath.lastIndexOf(marker);
  return at === -1 ? null : execPath.slice(0, at + ".app".length);
}

export function blockedLocation(bundle: string): "translocated" | "disk-image" | null {
  if (bundle.includes("/AppTranslocation/")) return "translocated";
  if (bundle.startsWith("/Volumes/")) return "disk-image";
  return null;
}

async function writable(file: string) {
  try {
    await access(file, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function installLocation(execPath: string): Promise<InstallLocation> {
  const bundle = bundleFromExecPath(execPath);
  if (bundle === null) throw new Error(`Not running from an app bundle: ${execPath}`);
  const blocked = blockedLocation(bundle);
  if (blocked) return { kind: blocked, bundle };
  // Renaming the bundle needs the parent folder; replacing it needs the bundle itself.
  const ok = (await writable(path.dirname(bundle))) && (await writable(bundle));
  return { kind: ok ? "ok" : "needs-admin", bundle };
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Developer keys for the outside services behind connected apps and cloud computers, and where
// the person wants bots' computers to run. Which service each key belongs to is named in
// @rakazo/adapters/desktop-server-env.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComputerChoice, ServiceKey } from "@rakazo/adapters/desktop-server-env";
import { KEYCHAIN_SERVICE } from "@rakazo/adapters/desktop-server-env";

export { type ComputerChoice, computerEnv } from "@rakazo/adapters/desktop-server-env";

/**
 * Reads a developer key from the macOS Keychain (account "gente"), when the workspace starts.
 * The value goes to the server processes' environment only.
 */
export function readServiceKey(
  key: ServiceKey,
  platform = process.platform,
): Promise<string | undefined> {
  if (platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", "gente", "-s", KEYCHAIN_SERVICE[key], "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

/**
 * Vendor keys never ship to users: user builds reach cloud computers, browsers, search and
 * connected apps only through Gente Cloud. A developer build (unpackaged), or a packaged build
 * with GENTE_DEV_VENDOR_KEYS=1 or a `dev-vendor-keys` file in its data folder, may still read them.
 */
export function vendorKeysAllowed(input: {
  packaged: boolean;
  env?: NodeJS.ProcessEnv;
  devFlagFile?: boolean;
}): boolean {
  if (!input.packaged) return true;
  return (input.env ?? process.env).GENTE_DEV_VENDOR_KEYS === "1" || input.devFlagFile === true;
}

/** Where bots' computers run: the person's pick, "cloud" unless they chose this computer. */
export const COMPUTER_CHOICE_FILE = "computer-choice";

export async function readComputerChoice(stackDir: string): Promise<ComputerChoice> {
  const raw = await readFile(path.join(stackDir, COMPUTER_CHOICE_FILE), "utf8").catch(() => "");
  return raw.trim() === "local" ? "local" : "cloud";
}

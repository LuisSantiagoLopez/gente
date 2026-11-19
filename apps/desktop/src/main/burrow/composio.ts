// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Reads a Gente secret from the macOS Keychain (account "gente", service = the name), when the
 * workspace starts. The value goes to the server processes' environment only.
 */
export function readKeychainSecret(
  service: "COMPOSIO_API_KEY" | "E2B_API_KEY",
  platform = process.platform,
): Promise<string | undefined> {
  if (platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", "gente", "-s", service, "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

/** The Composio Connect consumer key; the server adds it for connect.composio.dev only. */
export const readComposioKey = (platform = process.platform) =>
  readKeychainSecret("COMPOSIO_API_KEY", platform);

/** Where bots' computers run: E2B's cloud (the default with a key), or this computer. */
export type ComputerChoice = "cloud" | "local";
export const COMPUTER_CHOICE_FILE = "computer-choice";

export async function readComputerChoice(stackDir: string): Promise<ComputerChoice> {
  const raw = await readFile(path.join(stackDir, COMPUTER_CHOICE_FILE), "utf8").catch(() => "");
  return raw.trim() === "local" ? "local" : "cloud";
}

/**
 * The sandbox settings for the server: E2B when there is a key and the person did not pick the
 * private local option; otherwise the platform's local choice (VMs on a Mac, none on Windows).
 */
export function computerEnv(
  e2bKey: string | undefined,
  choice: ComputerChoice,
  localProvider: "local-vm" | "none",
): Record<string, string> {
  if (e2bKey && choice === "cloud") return { SANDBOX_PROVIDER: "e2b", E2B_API_KEY: e2bKey };
  return { SANDBOX_PROVIDER: localProvider };
}

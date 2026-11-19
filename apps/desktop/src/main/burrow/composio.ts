// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { execFile } from "node:child_process";

/**
 * The Composio Connect consumer key, read from the OS keychain when the workspace starts:
 * the macOS Keychain item (account "gente", service "COMPOSIO_API_KEY"). It goes to the server
 * processes' environment only; the server adds it to requests for connect.composio.dev.
 */
export function readComposioKey(platform = process.platform): Promise<string | undefined> {
  if (platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", "gente", "-s", "COMPOSIO_API_KEY", "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

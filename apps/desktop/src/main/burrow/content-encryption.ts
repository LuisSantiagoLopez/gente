// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Encrypts chats saved before encryption at rest was on. The server's own `content-encryption
// migrate` does the work (AES-256-GCM per space, master key from ENCRYPTION_KEY, which Gente keeps
// sealed by the system keychain). It is safe to run again; a marker file skips it once done.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunDocker } from "../this-computer/docker-cli.js";

export const CONTENT_ENCRYPTED_MARKER = "content-encrypted";
const ENCRYPT_TIMEOUT_MS = 30 * 60_000;

export interface EncryptInput {
  run: RunDocker;
  nodeBinary: string;
  server: { dir: string; manifest: { entrypoints: { encrypt?: string } } };
  env: Record<string, string>;
  marker: string;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

/**
 * Returns "done" (now or earlier), "unavailable" (an older server without the tool) or "retry"
 * (it failed; the server still starts, reads work either way, and the next start tries again).
 */
export async function encryptExistingContent(
  input: EncryptInput,
): Promise<"done" | "unavailable" | "retry"> {
  if (existsSync(input.marker)) return "done";
  const cli = input.server.manifest.entrypoints.encrypt;
  if (!cli) return "unavailable";
  const result = await input.run(input.nodeBinary, [path.join(input.server.dir, cli), "migrate"], {
    cwd: input.server.dir,
    env: { ...input.env, CONTENT_ENCRYPTION: "on" },
    timeoutMs: ENCRYPT_TIMEOUT_MS,
    signal: input.signal,
    onLine: input.onLine,
  });
  if (result.code !== 0) {
    input.onLine?.(`content encryption migrate exited ${result.code}; will retry next start`);
    return "retry";
  }
  await mkdir(path.dirname(input.marker), { recursive: true });
  await writeFile(input.marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  return "done";
}

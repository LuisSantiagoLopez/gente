// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The workspace's master secrets (the vault's ENCRYPTION_KEY and the sign-in secret) leave the
// plain `.env` file and live encrypted by the operating system: the macOS Keychain or Windows
// DPAPI, through Electron's safeStorage. The `.env` keeps only a `keychain:NAME` marker, so the
// value is never on disk in the clear and existing data keeps the same key.
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readPrivateFile, writePrivateFile } from "../setup/setup-store.js";
import { parseStackEnv, STACK_ENV_FILE } from "../this-computer/local-stack.js";

export interface Sealer {
  seal(value: string): Buffer;
  unseal(sealed: Buffer): string;
}

export const SEALED_SECRETS = ["ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "GENTE_COMPOSIO_KEY"] as const;
export const KEYCHAIN_MARKER = "keychain:";

const sealedFile = (stackDir: string, name: string) => path.join(stackDir, "keyring", `${name}.sealed`);

/** Moves plain secrets from `.env` into OS-encrypted files; safe to run on every start. */
export async function sealStackSecrets(stackDir: string, sealer: Sealer): Promise<string[]> {
  const envPath = path.join(stackDir, STACK_ENV_FILE);
  let text = await readFile(envPath, "utf8");
  const values = parseStackEnv(text);
  const moved: string[] = [];
  for (const name of SEALED_SECRETS) {
    const value = values.get(name) ?? "";
    if (value === "" || value.startsWith(KEYCHAIN_MARKER)) continue;
    await mkdir(path.join(stackDir, "keyring"), { recursive: true, mode: 0o700 });
    await writePrivateFile(sealedFile(stackDir, name), sealer.seal(value).toString("base64"));
    // Check the round trip before the plain value leaves the file.
    const back = sealer.unseal(Buffer.from((await readPrivateFile(sealedFile(stackDir, name), 65536)) ?? "", "base64"));
    if (back !== value) throw new Error(`Could not seal ${name} with the system keychain`);
    text = text.replace(
      new RegExp(`^([\\t ]*(?:export[\\t ]+)?${name}[\\t ]*=).*$`, "gm"),
      `$1${KEYCHAIN_MARKER}${name}`,
    );
    moved.push(name);
  }
  if (moved.length > 0) await writePrivateFile(envPath, text);
  return moved;
}

/** Replaces `keychain:NAME` markers with their values, for the server processes only. */
export async function unsealStackEnv(
  stackDir: string,
  env: Map<string, string>,
  sealer: Sealer,
): Promise<Map<string, string>> {
  const out = new Map(env);
  for (const [name, value] of env) {
    if (!value.startsWith(KEYCHAIN_MARKER)) continue;
    const raw = await readPrivateFile(sealedFile(stackDir, name), 65536);
    if (raw === null) throw new Error(`${name} is sealed but its keychain file is missing`);
    out.set(name, sealer.unseal(Buffer.from(raw, "base64")));
  }
  return out;
}

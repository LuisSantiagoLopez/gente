// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStackEnv } from "../this-computer/local-stack.js";
import { sealStackSecrets, unsealStackEnv } from "./keyring.js";

// Stands in for safeStorage: reversible, and never the plain text.
const sealer = {
  seal: (v: string) => Buffer.from(`sealed:${Buffer.from(v).toString("hex")}`),
  unseal: (b: Buffer) => Buffer.from(b.toString().slice(7), "hex").toString(),
};

describe("Your AI keyring", () => {
  it("moves the vault key and sign-in secret out of .env, keeps the same values, and is idempotent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-keyring-"));
    const key = "a".repeat(64);
    await writeFile(
      path.join(dir, ".env"),
      `POSTGRES_PASSWORD=pw\nENCRYPTION_KEY=${key}\nBETTER_AUTH_SECRET=s3cret\nGENTE_COMPOSIO_KEY=ck_test_123\n`,
    );
    expect(await sealStackSecrets(dir, sealer)).toEqual([
      "ENCRYPTION_KEY",
      "BETTER_AUTH_SECRET",
      "GENTE_COMPOSIO_KEY",
      "POSTGRES_PASSWORD",
    ]);

    const text = await readFile(path.join(dir, ".env"), "utf8");
    expect(text).toContain("POSTGRES_PASSWORD=keychain:POSTGRES_PASSWORD");
    expect(text).not.toContain(key);
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("ck_test_123");
    expect(text).toContain("ENCRYPTION_KEY=keychain:ENCRYPTION_KEY");
    for (const file of await readdir(path.join(dir, "keyring")))
      expect(await readFile(path.join(dir, "keyring", file), "utf8")).not.toContain(key);
    const env = await unsealStackEnv(dir, parseStackEnv(text), sealer);
    expect(env.get("ENCRYPTION_KEY")).toBe(key);
    expect(env.get("BETTER_AUTH_SECRET")).toBe("s3cret");
    expect(env.get("POSTGRES_PASSWORD")).toBe("pw");
    expect(env.get("GENTE_COMPOSIO_KEY")).toBe("ck_test_123");
    expect(await sealStackSecrets(dir, sealer)).toEqual([]);
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptExistingContent } from "./content-encryption.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gente-encrypt-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const server = (encrypt?: string) => ({ dir: "/srv", manifest: { entrypoints: { encrypt } } });

describe("encrypting chats saved before encryption at rest", () => {
  it("runs the server's migrate once with encryption on, then marks it done", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const marker = path.join(dir, "data", "content-encrypted");
    const input = { run, nodeBinary: "node", server: server("apps/api/dist/cli/content-encryption.js"), env: { ENCRYPTION_KEY: "k" }, marker };
    await expect(encryptExistingContent(input)).resolves.toBe("done");
    expect(run).toHaveBeenCalledWith(
      "node",
      ["/srv/apps/api/dist/cli/content-encryption.js", "migrate"],
      expect.objectContaining({ env: { ENCRYPTION_KEY: "k", CONTENT_ENCRYPTION: "on" } }),
    );
    expect(existsSync(marker)).toBe(true);
    await expect(encryptExistingContent(input)).resolves.toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps going and retries next start when the pass fails", async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: "", stderr: "boom" }));
    const marker = path.join(dir, "content-encrypted");
    const input = { run, nodeBinary: "node", server: server("cli.js"), env: {}, marker };
    await expect(encryptExistingContent(input)).resolves.toBe("retry");
    expect(existsSync(marker)).toBe(false);
  });

  it("skips quietly on an older server without the tool", async () => {
    const run = vi.fn();
    const input = { run, nodeBinary: "node", server: server(undefined), env: {}, marker: path.join(dir, "m") };
    await expect(encryptExistingContent(input)).resolves.toBe("unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing once the marker exists", async () => {
    const run = vi.fn();
    const marker = path.join(dir, "m");
    await writeFile(marker, "x");
    const input = { run, nodeBinary: "node", server: server("cli.js"), env: {}, marker };
    await expect(encryptExistingContent(input)).resolves.toBe("done");
    expect(run).not.toHaveBeenCalled();
  });
});

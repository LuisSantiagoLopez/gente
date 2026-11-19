// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPUTER_CHOICE_FILE, computerEnv, readComputerChoice } from "./composio.js";

describe("Gente bot computers", () => {
  it("defaults to the E2B cloud computer when a key exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-pc-"));
    expect(await readComputerChoice(dir)).toBe("cloud");
    expect(computerEnv("e2b_x", "cloud", "local-vm")).toEqual({ SANDBOX_PROVIDER: "e2b", E2B_API_KEY: "e2b_x" });
  });
  it("keeps the private local computer when picked, or when there is no key", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-pc-"));
    await writeFile(path.join(dir, COMPUTER_CHOICE_FILE), "local\n");
    expect(await readComputerChoice(dir)).toBe("local");
    expect(computerEnv("e2b_x", "local", "local-vm")).toEqual({ SANDBOX_PROVIDER: "local-vm" });
    expect(computerEnv(undefined, "cloud", "none")).toEqual({ SANDBOX_PROVIDER: "none" });
  });
});

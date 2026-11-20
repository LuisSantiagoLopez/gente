// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "", setPath: () => {} } }));
const { pickUserData } = await import("./legacy-user-data.js");

describe("Your AI keeps Burrow data", () => {
  const support = "/Users/x/Library/Application Support";
  it("reuses the Burrow folder when no Your AI folder exists", () => {
    const has = new Set([`${support}/Burrow/stack`, `${support}/Gente`]);
    expect(pickUserData(`${support}/Gente`, (d) => has.has(d))).toBe(`${support}/Burrow`);
  });
  it("prefers an existing Your AI folder", () => {
    const has = new Set([`${support}/Burrow/stack`, `${support}/Gente/stack`]);
    expect(pickUserData(`${support}/Gente`, (d) => has.has(d))).toBe(`${support}/Gente`);
  });
  it("starts fresh when neither exists", () => {
    expect(pickUserData(`${support}/Gente`, () => false)).toBe(`${support}/Gente`);
  });
});

describe("the keychain key for a data folder", () => {
  it("keeps the old Gente key for a folder from before the rename, and none for a new one", async () => {
    const { keychainAppName } = await import("./legacy-user-data.js");
    expect(keychainAppName("/Users/a/Library/Application Support/Burrow")).toBe("Gente");
    expect(keychainAppName("/Users/a/Library/Application Support/Gente")).toBe("Gente");
    expect(keychainAppName("/Users/a/Library/Application Support/Your AI")).toBeNull();
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "", setPath: () => {} } }));
const { pickUserData } = await import("./legacy-user-data.js");

describe("Gente keeps Burrow data", () => {
  const support = "/Users/x/Library/Application Support";
  it("reuses the Burrow folder when no Gente folder exists", () => {
    const has = new Set([`${support}/Burrow/stack`, `${support}/Gente`]);
    expect(pickUserData(`${support}/Gente`, (d) => has.has(d))).toBe(`${support}/Burrow`);
  });
  it("prefers an existing Gente folder", () => {
    const has = new Set([`${support}/Burrow/stack`, `${support}/Gente/stack`]);
    expect(pickUserData(`${support}/Gente`, (d) => has.has(d))).toBe(`${support}/Gente`);
  });
  it("starts fresh when neither exists", () => {
    expect(pickUserData(`${support}/Gente`, () => false)).toBe(`${support}/Gente`);
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// Version comparison for the Mac updater: newer only, never a downgrade, broken text refused.
import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion } from "./versions.js";

describe("compareVersions", () => {
  it.each([
    ["1.0.7", "1.0.6", 1],
    ["1.0.6", "1.0.6", 0],
    ["1.0.6", "1.0.10", -1],
    ["2.0.0", "1.99.99", 1],
    ["v1.0.7", "1.0.7", 0],
    ["1.0.7", "1.0.7-canary.3", 1],
    ["1.0.7-canary.10", "1.0.7-canary.9", 1],
    ["1.0.7-beta", "1.0.7-alpha", 1],
    ["1.0.7-1", "1.0.7-alpha", -1],
    ["1.0.7+build.5", "1.0.7", 0],
  ])("%s vs %s is %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("refuses text that is not a version", () => {
    expect(() => compareVersions("latest", "1.0.0")).toThrow("Not a version");
    expect(() => compareVersions("1.0", "1.0.0")).toThrow("Not a version");
  });

  it("only calls a strictly higher version newer", () => {
    expect(isNewerVersion("1.0.7", "1.0.6")).toBe(true);
    expect(isNewerVersion("1.0.6", "1.0.6")).toBe(false);
    expect(isNewerVersion("1.0.5", "1.0.6")).toBe(false);
  });
});

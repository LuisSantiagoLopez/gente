// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { turnLikelyNeedsComputer } from "./run-assembly-capabilities.js";

describe("starting the computer early (BENCH-005)", () => {
  it("starts it for attached files and plain computer work, not for chat or a photo", () => {
    expect(turnLikelyNeedsComputer([{ kind: "file" }], null)).toBe(true);
    expect(turnLikelyNeedsComputer([], { blocks: [{ kind: "text", text: "build me a website for my bakery" }] })).toBe(true);
    expect(turnLikelyNeedsComputer([], { blocks: [{ kind: "text", text: "reconcile these two CSV files" }] })).toBe(true);
    expect(turnLikelyNeedsComputer([], { blocks: [{ kind: "text", text: "hey, how are you?" }] })).toBe(false);
    expect(turnLikelyNeedsComputer([{ kind: "image" }], { blocks: [{ kind: "text", text: "what's in this photo?" }] })).toBe(false);
  });
});

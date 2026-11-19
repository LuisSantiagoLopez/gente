// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { withComposioKey } from "./composio-key.js";

describe("Composio Connect key", () => {
  it("adds the consumer key only for https://connect.composio.dev", () => {
    expect(withComposioKey("https://connect.composio.dev/mcp", undefined, "ck_x")).toEqual({
      "x-consumer-api-key": "ck_x",
    });
    expect(withComposioKey("https://evil.example/mcp", undefined, "ck_x")).toBeUndefined();
    expect(withComposioKey("http://connect.composio.dev/mcp", undefined, "ck_x")).toBeUndefined();
    expect(withComposioKey("https://connect.composio.dev.evil.example/mcp", { a: "1" }, "ck_x")).toEqual({ a: "1" });
  });
  it("keeps a header the person set, and does nothing without a key", () => {
    const own = { "X-Consumer-Api-Key": "mine" };
    expect(withComposioKey("https://connect.composio.dev/mcp", own, "ck_x")).toBe(own);
    expect(withComposioKey("https://connect.composio.dev/mcp", undefined, "")).toBeUndefined();
  });
});

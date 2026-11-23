// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests that Cloud GPU's larger window reaches runs without a restart.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_LIMITS_FILE_ENV, withLiveLimits } from "./pi-local-limits.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "local-limits-"));
const file = path.join(dir, "cloud-gpu-limits.json");
afterEach(() => rmSync(file, { force: true }));

describe("live local limits", () => {
  it("uses the start-up window until Cloud GPU writes a larger one, then goes back", () => {
    const env = { [LOCAL_LIMITS_FILE_ENV]: file };
    const model = withLiveLimits(
      { id: "yourai-default", contextWindow: 32_768, maxTokens: 8192 },
      env,
    );
    expect(model.contextWindow).toBe(32_768);
    writeFileSync(file, JSON.stringify({ contextWindow: 131_072, maxTokens: 32_768 }));
    expect(model.contextWindow).toBe(131_072);
    expect(model.maxTokens).toBe(32_768);
    // A run's own copy keeps its values.
    const forRun = { ...model };
    rmSync(file);
    expect(model.contextWindow).toBe(32_768);
    expect(forRun.contextWindow).toBe(131_072);
  });

  it("changes nothing when no limits file is configured", () => {
    const model = withLiveLimits({ contextWindow: 32_768, maxTokens: 8192 }, {});
    expect(Object.getOwnPropertyDescriptor(model, "contextWindow")?.value).toBe(32_768);
  });
});

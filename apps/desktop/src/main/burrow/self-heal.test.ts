// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DesktopLocalStackState } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { CALM_FAILURE, StackSelfHeal } from "./self-heal.js";

const failed = (output: string[]): DesktopLocalStackState =>
  ({ phase: "failed", message: "Your AI services did not start.", output, layerBytes: {}, imageTag: "v1" }) as DesktopLocalStackState;

describe("Your AI self-heal", () => {
  it("retries three times quietly, then shows one calm sentence with no technical output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-heal-"));
    const scheduled: Array<() => void> = [];
    const heal = new StackSelfHeal(dir, [1, 1, 1], (fn) => {
      scheduled.push(fn);
      return 0 as unknown as NodeJS.Timeout;
    });
    let restarts = 0;
    heal.bind(() => restarts++);
    const state = failed(["Download of server-0.2.0 answered HTTP 404", "Error: ECONNRESET"]);
    for (let i = 0; i < 3; i++) {
      heal.observe(state);
      expect(heal.present(state).phase).toBe("starting");
      scheduled.shift()?.();
    }
    expect(restarts).toBe(3);
    heal.observe(state);
    const shown = heal.present(state);
    expect(shown.phase).toBe("failed");
    expect(shown.output).toEqual([]);
    expect(shown.message).not.toMatch(/HTTP|\d{3}|ECONN|Error/);
    expect(shown.message).toBe(CALM_FAILURE);
    await new Promise((r) => setTimeout(r, 50));
    const log = await readFile(path.join(dir, "setup.log"), "utf8");
    expect(log).toContain("HTTP 404");
  });
});

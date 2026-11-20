// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { SandboxTaskLimitError } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyRunComputer } from "../runs/assembly/run-computer.js";
import {
  attemptsActiveMs,
  computerTaskMaxActiveMs,
  DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS,
  taskComputerBudget,
} from "./computer-task-limit.js";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
const HOUR = 60 * 60_000;

describe("attemptsActiveMs", () => {
  it("adds finished attempts and the current one up to now", () => {
    const attempts = [
      { id: "a", startedAt: at(0), finishedAt: at(30) },
      { id: "b", startedAt: at(100), finishedAt: null },
    ];
    expect(attemptsActiveMs(attempts, "b", at(130))).toBe(60 * 60_000);
  });

  it("counts a crashed attempt until the next one began, not until now", () => {
    const attempts = [
      { id: "b", startedAt: at(45), finishedAt: null },
      { id: "a", startedAt: at(0), finishedAt: null },
    ];
    expect(attemptsActiveMs(attempts, "b", at(50))).toBe(50 * 60_000);
  });

  it("leaves time between attempts out, such as waiting for the user", () => {
    const attempts = [
      { id: "a", startedAt: at(0), finishedAt: at(10) },
      { id: "b", startedAt: at(600), finishedAt: null },
    ];
    expect(attemptsActiveMs(attempts, "b", at(605))).toBe(15 * 60_000);
  });
});

describe("computerTaskMaxActiveMs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to six hours, accepts 0 to turn it off, and ignores tiny or bad values", () => {
    expect(computerTaskMaxActiveMs()).toBe(DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS);
    vi.stubEnv("COMPUTER_TASK_MAX_ACTIVE_MS", "0");
    expect(computerTaskMaxActiveMs()).toBe(0);
    vi.stubEnv("COMPUTER_TASK_MAX_ACTIVE_MS", "5000");
    expect(computerTaskMaxActiveMs()).toBe(DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS);
    vi.stubEnv("COMPUTER_TASK_MAX_ACTIVE_MS", String(HOUR));
    expect(computerTaskMaxActiveMs()).toBe(HOUR);
  });
});

describe("taskComputerBudget", () => {
  it("reads earlier attempts once and times the current one", async () => {
    const findMany = vi.fn(async () => [
      { id: "old", startedAt: at(0), finishedAt: at(50) },
      { id: "now", startedAt: at(60), finishedAt: null },
    ]);
    const budget = taskComputerBudget(
      { attempt: { findMany } } as never,
      { runId: "run", attemptId: "now" },
      HOUR,
    );
    expect(await budget.exceeded(at(65))).toBe(false);
    expect(await budget.exceeded(at(70))).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("never reads anything when the limit is off", async () => {
    const findMany = vi.fn();
    const budget = taskComputerBudget(
      { attempt: { findMany } } as never,
      { runId: "run", attemptId: "now" },
      0,
    );
    expect(await budget.exceeded(at(10_000))).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("lazyRunComputer.fail", () => {
  it("aborts the run once and rejects every later use with the limit error", async () => {
    const start = vi.fn(async () => ({ kind: "e2b", homeKey: "h", providerRef: "p" }) as never);
    const onFailure = vi.fn();
    const computer = lazyRunComputer(start, onFailure);
    await computer.get();
    const error = new SandboxTaskLimitError(HOUR);
    expect(() => computer.fail(error)).toThrow(error);
    expect(() => computer.fail(new Error("second"))).toThrow(error);
    await expect(computer.get()).rejects.toBe(error);
    expect(() => computer.throwIfFailed()).toThrow(error);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("lazyRunComputer.lost", () => {
  it("starts the computer again on the next use after its provider lost it", async () => {
    const start = vi.fn(async () => ({ kind: "e2b", homeKey: "h", providerRef: "p" }) as never);
    const computer = lazyRunComputer(start);
    await computer.get();
    computer.lost();
    expect(computer.ready).toBeUndefined();
    await computer.get();
    expect(start).toHaveBeenCalledTimes(2);
  });
});

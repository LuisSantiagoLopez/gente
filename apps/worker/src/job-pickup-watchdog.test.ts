// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import { startJobPickupWatchdog } from "./job-pickup-watchdog.js";

describe("job pickup watchdog", () => {
  it("restarts the worker after two checks with a stuck job, not after one", async () => {
    const onUnhealthy = vi.fn();
    const pool = { query: vi.fn(async () => ({ rows: [{ stuck: 1 }] })) };
    const dog = startJobPickupWatchdog(pool as never, { onUnhealthy, intervalMs: 60_000 });
    await dog.check();
    expect(onUnhealthy).not.toHaveBeenCalled();
    await dog.check();
    expect(onUnhealthy).toHaveBeenCalledWith("1 ready job(s) not picked up");
    dog.stop();
  });

  it("restarts the worker when the database stops answering", async () => {
    const onUnhealthy = vi.fn();
    const pool = { query: vi.fn(async () => { throw new Error("Client has encountered a connection error and is not queryable"); }) };
    const dog = startJobPickupWatchdog(pool as never, { onUnhealthy, intervalMs: 60_000 });
    await dog.check();
    await dog.check();
    expect(onUnhealthy.mock.calls[0]?.[0]).toMatch(/not queryable/);
    dog.stop();
  });

  it("forgives a single bad check once things recover", async () => {
    const onUnhealthy = vi.fn();
    const rows = [[{ stuck: 2 }], [{ stuck: 0 }], [{ stuck: 3 }]];
    const pool = { query: vi.fn(async () => ({ rows: rows.shift() })) };
    const dog = startJobPickupWatchdog(pool as never, { onUnhealthy, intervalMs: 60_000 });
    await dog.check();
    await dog.check();
    await dog.check();
    expect(onUnhealthy).not.toHaveBeenCalled();
    dog.stop();
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { ModelOutputError, TransientModelError } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  MODEL_OUTAGE_ATTEMPT_NOTE,
  MODEL_OUTAGE_REQUEUES,
  requeueRunAfterLostLease,
  requeueRunAfterModelOutage,
} from "./run-fail.js";

function context(options: { saved: boolean; attempts: number }) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const enqueue = vi.fn(async () => undefined);
  const ctx = {
    deps: {
      prisma: {
        attempt: {
          count: vi.fn(async () => options.attempts),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        run: { updateMany },
      },
      jobs: { enqueue, enqueueMany: enqueue, remove: vi.fn(), reschedule: vi.fn() },
    },
    runId: "run-1",
    workerId: "worker-1",
    fence: 3,
    attempt: { id: "attempt-1" },
    computer: { checkpoint: { flush: vi.fn(async () => undefined) } },
    state: { effects: { storedTurnCheckpoint: options.saved }, lease: { handedBack: false } },
  };
  return { ctx, updateMany };
}

describe("a model server outage", () => {
  it("hands a turn with saved steps back to resume later instead of failing it", async () => {
    const { ctx, updateMany } = context({ saved: true, attempts: 1 });
    const before = Date.now();

    expect(await requeueRunAfterModelOutage(ctx as never, new TransientModelError("down"))).toBe(
      true,
    );

    expect(ctx.state.lease.handedBack).toBe(true);
    // Counts only earlier waits, never restarts or busy-computer retries.
    expect(ctx.deps.prisma.attempt.count).toHaveBeenCalledWith({
      where: { runId: "run-1", error: MODEL_OUTAGE_ATTEMPT_NOTE },
    });
    expect(ctx.deps.prisma.attempt.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1" },
      data: { error: MODEL_OUTAGE_ATTEMPT_NOTE },
    });
    const data = (updateMany.mock.calls[0] as unknown as [{ data: { wakeAt: Date } }])[0].data;
    expect(data).toMatchObject({ status: "queued", leaseOwner: null });
    expect(data.wakeAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it("fails a turn with nothing saved, other errors, and a turn past its waits", async () => {
    const fresh = context({ saved: false, attempts: 1 });
    expect(await requeueRunAfterModelOutage(fresh.ctx as never, new TransientModelError("x"))).toBe(
      false,
    );
    const other = context({ saved: true, attempts: 1 });
    expect(await requeueRunAfterModelOutage(other.ctx as never, new ModelOutputError("x"))).toBe(
      false,
    );
    const spent = context({ saved: true, attempts: MODEL_OUTAGE_REQUEUES });
    expect(await requeueRunAfterModelOutage(spent.ctx as never, new TransientModelError("x"))).toBe(
      false,
    );
    for (const { updateMany } of [fresh, other, spent]) expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("an attempt that stopped because its lease could have lapsed", () => {
  it("hands the run back to resume instead of failing it", async () => {
    const { ctx, updateMany } = context({ saved: true, attempts: 0 });
    await requeueRunAfterLostLease(ctx as never);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1", status: "running", leaseOwner: "worker-1", leaseFence: 3 },
        data: expect.objectContaining({ status: "queued" }),
      }),
    );
    expect(ctx.state.lease.handedBack).toBe(true);
  });

  it("leaves a run another process claimed meanwhile alone", async () => {
    const { ctx, updateMany } = context({ saved: true, attempts: 0 });
    updateMany.mockResolvedValueOnce({ count: 0 });
    await requeueRunAfterLostLease(ctx as never);
    expect(ctx.state.lease.handedBack).toBe(false);
  });
});

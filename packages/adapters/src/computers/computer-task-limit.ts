// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { PrismaClient } from "@rakazo/db";

/**
 * Default cap on how long one task may keep a computer that bills while running. A long coding
 * job runs for hours, so the cap sits above that and only stops a task that never ends, such as
 * one stuck re-running a step across restarts. COMPUTER_TASK_MAX_ACTIVE_MS configures it; 0
 * turns it off.
 */
export const DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS = 6 * 60 * 60 * 1000;

export function computerTaskMaxActiveMs(): number {
  const raw = Number(
    process.env.COMPUTER_TASK_MAX_ACTIVE_MS?.trim() || DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS,
  );
  return Number.isFinite(raw) && (raw === 0 || raw >= 60_000)
    ? raw
    : DEFAULT_COMPUTER_TASK_MAX_ACTIVE_MS;
}

/**
 * How long a run's attempts have worked, the current one up to `now`. An attempt that never
 * recorded its end (its worker crashed or the app quit) counts until the next attempt began,
 * since the computer it held could have kept running that long. Waiting for input or a takeover
 * ends an attempt, so that time does not count.
 */
export function attemptsActiveMs(
  attempts: readonly { id: string; startedAt: Date; finishedAt: Date | null }[],
  currentAttemptId: string,
  now: Date,
): number {
  const ordered = [...attempts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let total = 0;
  for (const [index, attempt] of ordered.entries()) {
    const end =
      attempt.id === currentAttemptId
        ? now
        : (attempt.finishedAt ?? ordered[index + 1]?.startedAt ?? attempt.startedAt);
    total += Math.max(0, end.getTime() - attempt.startedAt.getTime());
  }
  return total;
}

/**
 * Checks before each computer use whether this task has spent its computer time. The earlier
 * attempts are read once; the current one is timed in memory.
 */
export function taskComputerBudget(
  prisma: Pick<PrismaClient, "attempt">,
  run: { runId: string; attemptId: string },
  limitMs = computerTaskMaxActiveMs(),
) {
  let attempts: Promise<{ id: string; startedAt: Date; finishedAt: Date | null }[]> | undefined;
  return {
    limitMs,
    /** Whether the task is past its limit now. */
    async exceeded(now = new Date()): Promise<boolean> {
      if (limitMs === 0) return false;
      attempts ??= prisma.attempt.findMany({
        where: { runId: run.runId },
        select: { id: true, startedAt: true, finishedAt: true },
      });
      return attemptsActiveMs(await attempts, run.attemptId, now) >= limitMs;
    },
  };
}

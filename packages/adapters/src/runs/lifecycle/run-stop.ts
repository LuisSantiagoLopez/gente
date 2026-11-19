// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
import type { RunStatus } from "@rakazo/contracts";
import { isTerminal } from "@rakazo/core";
import {
  appendEventInTransaction,
  cancelRunsInTransaction,
  createPendingSteeringRun,
} from "@rakazo/db";
import { bestEffort } from "@rakazo/logging";
import type { ExecutorDeps } from "../executor/executor-deps.js";
import { wakeRun } from "../wakeups/wake-run.js";

type StoppableRun = {
  id: string;
  spaceId: string;
  userId: string;
  threadId: string;
  botId: string;
};

/**
 * Cancels one active run, tells the chat it ended, and gives messages that waited behind it a
 * run of their own. Returns false when the run had already ended.
 */
export async function cancelActiveRun(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: StoppableRun,
): Promise<boolean> {
  const cancelled = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.run.findUnique({
      where: { id: run.id },
      select: { id: true, taskId: true, userId: true, spaceId: true, status: true },
    });
    if (!current || isTerminal(current.status as RunStatus)) return null;
    const [stopped] = await cancelRunsInTransaction(tx, [current], new Date());
    if (!stopped) return null;
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      runId: run.id,
      type: "run.cancelled",
      payload: {},
    });
    const continuationId = await createPendingSteeringRun(tx, run);
    return { seq: event.seq, continuationId };
  });
  if (!cancelled) return false;
  await bestEffort("run.cancelled notify", deps.events.notify(run.threadId, cancelled.seq));
  if (cancelled.continuationId) await wakeRun(deps.jobs, cancelled.continuationId);
  return true;
}

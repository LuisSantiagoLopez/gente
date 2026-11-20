// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { JobPublisher } from "@rakazo/adapter-kit";
import { proactiveCycleJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { ownersWithGoals } from "./proactive-store.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The proactive schedule: once an hour, each person with a goal gets one pass, queued as a job
 * keyed by the hour so a second reconciler or a restart never queues it twice. The engine's
 * cadence, caps and quiet hours decide whether that pass does anything.
 */
export function createProactiveReconciler(deps: {
  prisma: PrismaClient;
  jobs: JobPublisher;
  now?: () => Date;
}): () => Promise<void> {
  let lastHour: number | undefined;
  return async () => {
    const now = deps.now?.() ?? new Date();
    const hour = Math.floor(now.getTime() / HOUR_MS);
    if (lastHour === hour) return;
    const owners = await ownersWithGoals(deps.prisma);
    for (const owner of owners) {
      await deps.jobs.enqueue(proactiveCycleJob(owner, `hour:${hour}`));
    }
    lastHour = hour;
    if (owners.length)
      getLogger().info("proactive passes queued", { "proactive.owners": owners.length });
  };
}

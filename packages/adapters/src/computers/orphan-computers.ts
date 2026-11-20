// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { createHash } from "node:crypto";
import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/** Metadata key a provider stores on each machine this deployment starts. */
export const COMPUTER_OWNER_METADATA_KEY = "rakazoOwner";

/**
 * A stable tag for this deployment, so the orphan sweep only ever touches machines this
 * deployment started, even when several deployments share one provider account. Derived from
 * the deployment's own sign-in secret; without one nothing is tagged and nothing is swept.
 */
export function computerOwnerTag(secret = process.env.BETTER_AUTH_SECRET): string | undefined {
  const value = secret?.trim();
  if (!value) return undefined;
  return createHash("sha256").update(`rakazo-computer-owner:${value}`).digest("hex").slice(0, 24);
}

/** A machine started this long ago may still be on its way into the database. */
export const ORPHAN_GRACE_MS = 15 * 60_000;
const ORPHAN_SWEEP_INTERVAL_MS = 30 * 60_000;
const LIST_TIMEOUT_MS = 30_000;
/** States in which the database expects the provider's machine to be up. */
const UP_STATES = new Set(["running", "starting", "suspending"]);

export type OwnedRunningMachine = { kind: string; providerRef: string; startedAt: Date };

/**
 * Stops machines the provider still runs but nothing here uses: a machine no computer row names
 * (its start crashed before saving it, or its computer was removed) is deleted, and one whose
 * computer is recorded as stopped (a pause that failed) is paused again. Slow safety net on the
 * reconciler's tick; every machine it acts on was started by this deployment and has been up
 * longer than ORPHAN_GRACE_MS.
 */
export function createOrphanComputerSweeper(
  deps: {
    prisma: Pick<PrismaClient, "computer">;
    sandbox: Pick<SandboxProvider, "listOwnedRunning" | "destroy" | "stop">;
  },
  options: { intervalMs?: number; now?: () => number } = {},
): () => Promise<void> {
  const intervalMs = options.intervalMs ?? ORPHAN_SWEEP_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastRun: number | undefined;
  return async () => {
    const list = deps.sandbox.listOwnedRunning;
    if (!list) return;
    const started = now();
    if (lastRun !== undefined && started - lastRun < intervalMs) return;
    lastRun = started;
    const running = (await list.call(deps.sandbox, AbortSignal.timeout(LIST_TIMEOUT_MS))).filter(
      (machine) => started - machine.startedAt.getTime() >= ORPHAN_GRACE_MS,
    );
    if (running.length === 0) return;
    const rows = await deps.prisma.computer.findMany({
      where: { providerRef: { in: running.map((machine) => machine.providerRef) } },
      select: {
        id: true,
        botId: true,
        kind: true,
        providerRef: true,
        state: true,
        updatedAt: true,
      },
    });
    for (const machine of running) {
      const row = rows.find(
        (computer) =>
          computer.providerRef === machine.providerRef && computer.kind === machine.kind,
      );
      // Recorded as up, or changed recently: the idle checks own it.
      if (row && (UP_STATES.has(row.state) || started - row.updatedAt.getTime() < ORPHAN_GRACE_MS))
        continue;
      const ref: ComputerRef = {
        id: row?.id ?? machine.providerRef,
        botId: row?.botId ?? "",
        kind: machine.kind as ComputerRef["kind"],
        providerRef: machine.providerRef,
      };
      const context: AdapterContext = {
        operationId: "computer.orphan_sweep",
        traceId: "computer.orphan_sweep",
        spaceId: "",
        userId: "",
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      };
      const fields = {
        provider: machine.kind,
        "computer.provider_ref": machine.providerRef,
        "computer.id": row?.id,
        "computer.state": row?.state,
        "machine.up_ms": started - machine.startedAt.getTime(),
      };
      try {
        if (row) {
          await deps.sandbox.stop(ref, context);
          getLogger().warn("computer.orphan_paused", fields);
        } else {
          await deps.sandbox.destroy(ref, context);
          getLogger().warn("computer.orphan_deleted", fields);
        }
      } catch (error) {
        // The next sweep tries again; one machine must not hold back the rest.
        getLogger().error("computer.orphan_sweep_failed", error, fields);
      }
    }
  };
}

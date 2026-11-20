// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Step 1 of the self-healing pipeline: read the diagnostics bundles people chose to send and group
// them by failure signature, so one fix covers every computer that hit the same failure.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticsBundle } from "../../apps/desktop/src/main/support/diagnostics.js";

export type Cluster = {
  signature: string;
  code: string;
  source: string;
  /** How many reports carry this signature, and from how many app versions. */
  reports: number;
  versions: string[];
  platforms: string[];
  /** The CI runners that match every OS the reports came from. */
  runners: Runner[];
  firstSeen: string;
  lastSeen: string;
  /** One redacted report, for the agent to read. */
  sample: DiagnosticsBundle;
  message: string;
  stack?: string;
};

/** Bundles saved as JSON files (dry runs, or an export of the intake table). */
export async function bundlesFromDir(dir: string): Promise<DiagnosticsBundle[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(
      async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as DiagnosticsBundle,
    ),
  );
}

/** Reports from Gente Cloud's self-heal service, newest first. The CI token is needed. */
export async function bundlesFromCloud(
  url: string,
  token: string,
  since: string,
  fetcher: typeof fetch = fetch,
): Promise<DiagnosticsBundle[]> {
  const res = await fetcher(`${url}/reports?since=${encodeURIComponent(since)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`self-heal service answered ${res.status}`);
  return ((await res.json()) as { bundle: DiagnosticsBundle }[]).map((row) => row.bundle);
}

export type Runner = "macos-15" | "windows-2025";

/** One runner per OS seen: a failure seen on both is reproduced on both. */
export function runnersFor(platforms: readonly string[]): Runner[] {
  const runners: Runner[] = [];
  if (platforms.includes("darwin")) runners.push("macos-15");
  if (platforms.includes("win32")) runners.push("windows-2025");
  return runners.length > 0 ? runners : ["macos-15"];
}

/** Groups every failure in every bundle by signature, biggest group first. */
export function groupBySignature(bundles: readonly DiagnosticsBundle[]): Cluster[] {
  const groups = new Map<
    string,
    { cluster: Omit<Cluster, "runners" | "platforms">; platforms: string[] }
  >();
  for (const bundle of bundles) {
    for (const failure of bundle.failures) {
      const existing = groups.get(failure.signature);
      if (existing) {
        existing.cluster.reports += failure.count;
        if (!existing.cluster.versions.includes(bundle.app.version))
          existing.cluster.versions.push(bundle.app.version);
        existing.platforms.push(bundle.os.platform);
        if (failure.lastAt > existing.cluster.lastSeen) existing.cluster.lastSeen = failure.lastAt;
        if (failure.lastAt < existing.cluster.firstSeen)
          existing.cluster.firstSeen = failure.lastAt;
        continue;
      }
      groups.set(failure.signature, {
        platforms: [bundle.os.platform],
        cluster: {
          signature: failure.signature,
          code: failure.code,
          source: failure.source,
          reports: failure.count,
          versions: [bundle.app.version],
          firstSeen: failure.lastAt,
          lastSeen: failure.lastAt,
          sample: bundle,
          message: failure.message,
          ...(failure.stack ? { stack: failure.stack } : {}),
        },
      });
    }
  }
  return [...groups.values()]
    .map(({ cluster, platforms }) => ({
      ...cluster,
      platforms: [...new Set(platforms)],
      runners: runnersFor(platforms),
    }))
    .sort((a, b) => b.reports - a.reports || a.signature.localeCompare(b.signature));
}

/** One anonymous self-repair from an install that shares reports ("Always send"). */
export type RepairEvent = {
  failureId: string;
  outcome: string;
  fixedBy?: string;
  ms?: number;
  version: string;
  platform: string;
  installId: string;
  createdAt?: string;
};

export type FleetGroup = {
  failureId: string;
  devices: number;
  events: number;
  /** Share of events the device fixed by itself. */
  fixedShare: number;
  medianMs: number | null;
  versions: string[];
  platforms: string[];
  runners: Runner[];
};

/**
 * Fleet learning: groups self-repairs by failure. A failure seen on at least `minDevices` installs
 * is a bug to fix at the source, even when every device healed itself.
 */
export function groupRepairs(events: readonly RepairEvent[], minDevices: number): FleetGroup[] {
  const by = new Map<string, RepairEvent[]>();
  for (const e of events) by.set(e.failureId, [...(by.get(e.failureId) ?? []), e]);
  const groups: FleetGroup[] = [];
  for (const [failureId, list] of by) {
    const devices = new Set(list.map((e) => e.installId)).size;
    if (devices < minDevices) continue;
    const times = list
      .flatMap((e) => (typeof e.ms === "number" ? [e.ms] : []))
      .sort((a, b) => a - b);
    const platforms = [...new Set(list.map((e) => e.platform))];
    groups.push({
      failureId,
      devices,
      events: list.length,
      fixedShare: list.filter((e) => e.outcome === "fixed").length / list.length,
      medianMs: times.length ? (times[Math.floor(times.length / 2)] ?? null) : null,
      versions: [...new Set(list.map((e) => e.version))],
      platforms,
      runners: runnersFor(platforms),
    });
  }
  return groups.sort((a, b) => b.devices - a.devices);
}

export async function repairsFromCloud(
  url: string,
  token: string,
  since: string,
  fetcher: typeof fetch = fetch,
) {
  const res = await fetcher(`${url}/repairs?since=${encodeURIComponent(since)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`self-heal service answered ${res.status}`);
  return (await res.json()) as RepairEvent[];
}

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

/** Bundles from the intake table (Supabase REST), newest first. Needs a service key in CI only. */
export async function bundlesFromTable(input: {
  url: string;
  serviceKey: string;
  since: string;
  fetcher?: typeof fetch;
}): Promise<DiagnosticsBundle[]> {
  const res = await (input.fetcher ?? fetch)(
    `${input.url}/rest/v1/gente_diagnostics?select=bundle&created_at=gte.${encodeURIComponent(input.since)}&order=created_at.desc&limit=5000`,
    { headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}` } },
  );
  if (!res.ok) throw new Error(`intake table answered ${res.status}`);
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

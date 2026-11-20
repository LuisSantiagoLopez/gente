// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Steps 6 and 7: the staged rollout. A fix that passed every gate is published to the canary
// channel at once, and to everyone else in stages: 5%, then 25%, then 100%. electron-updater reads
// `stagingPercentage` from the update feed and lets each install in or out by a stable random id.
// Between stages the crash-free rate and the setup success rate of the new version are compared
// with the version before it. A drop rolls it back; too little data holds it where it is.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const STAGES = [5, 25, 100] as const;
export type Stage = (typeof STAGES)[number];

export type VersionMetrics = {
  version: string;
  launches: number;
  crashes: number;
  setupOk: number;
  setupFail: number;
};

export type RolloutPolicy = {
  /** Launches of the new version needed before a stage is judged. */
  minLaunches: number;
  /** Hours each stage runs before it can move on. */
  minHoursPerStage: number;
  /** The new version's crash-free rate may never go below this, whatever the old one had. */
  crashFreeFloor: number;
  /** How far below the old version each rate may fall, in rate points (0.005 = half a point). */
  crashFreeTolerance: number;
  setupTolerance: number;
  /** Setup success is judged only with at least this many setups. */
  minSetups: number;
};

export const DEFAULT_POLICY: RolloutPolicy = {
  minLaunches: 200,
  minHoursPerStage: 24,
  crashFreeFloor: 0.99,
  crashFreeTolerance: 0.005,
  setupTolerance: 0.02,
  minSetups: 20,
};

export const crashFree = (m: VersionMetrics) => (m.launches === 0 ? 1 : 1 - m.crashes / m.launches);
export const setupSuccess = (m: VersionMetrics) =>
  m.setupOk + m.setupFail === 0 ? 1 : m.setupOk / (m.setupOk + m.setupFail);

export type Decision =
  | { action: "advance"; to: Stage; reason: string }
  | { action: "hold"; reason: string }
  | { action: "rollback"; reason: string }
  | { action: "done"; reason: string };

export function decide(input: {
  stage: Stage;
  hoursAtStage: number;
  candidate: VersionMetrics;
  baseline: VersionMetrics;
  policy?: RolloutPolicy;
}): Decision {
  const policy = input.policy ?? DEFAULT_POLICY;
  const { candidate, baseline } = input;
  const cf = crashFree(candidate);
  const cfBase = crashFree(baseline);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  // A crash spike rolls back at once, even before the sample is big enough to advance on.
  const crashLimit = Math.max(policy.crashFreeFloor, cfBase - policy.crashFreeTolerance);
  if (candidate.launches >= Math.min(50, policy.minLaunches) && cf < crashLimit)
    return {
      action: "rollback",
      reason: `crash-free ${pct(cf)} is below ${pct(crashLimit)} (was ${pct(cfBase)})`,
    };
  const setups = candidate.setupOk + candidate.setupFail;
  if (setups >= policy.minSetups) {
    const ss = setupSuccess(candidate);
    const ssBase = setupSuccess(baseline);
    if (ss < ssBase - policy.setupTolerance)
      return {
        action: "rollback",
        reason: `setup success ${pct(ss)} is below ${pct(ssBase - policy.setupTolerance)} (was ${pct(ssBase)})`,
      };
  }
  if (input.stage === 100) return { action: "done", reason: "at 100% with healthy metrics" };
  if (candidate.launches < policy.minLaunches)
    return {
      action: "hold",
      reason: `${candidate.launches} of ${policy.minLaunches} launches needed`,
    };
  if (input.hoursAtStage < policy.minHoursPerStage)
    return {
      action: "hold",
      reason: `${input.hoursAtStage} of ${policy.minHoursPerStage} hours at ${input.stage}%`,
    };
  const next = STAGES[STAGES.indexOf(input.stage) + 1] as Stage;
  return {
    action: "advance",
    to: next,
    reason: `crash-free ${pct(cf)} (was ${pct(cfBase)}), setup ${pct(setupSuccess(candidate))}`,
  };
}

/** Where update feeds live: a folder in dry runs, an update bucket in production. */
export type FeedStore = {
  read: (file: string) => Promise<string | null>;
  write: (file: string, content: string) => Promise<void>;
};

export function folderFeed(dir: string): FeedStore {
  return {
    read: (file) => readFile(path.join(dir, file), "utf8").catch(() => null),
    write: async (file, content) => {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, file), content);
    },
  };
}

/** The feed files electron-updater reads for one channel, per platform. */
export const feedFiles = (channel: "latest" | "canary") => [`${channel}.yml`, `${channel}-mac.yml`];

/** Sets or replaces `stagingPercentage` in an electron-updater feed file. */
export function withStaging(yml: string, percent: number): string {
  const lines = yml.split("\n").filter((line) => !line.startsWith("stagingPercentage:"));
  const at = lines.findIndex((line) => line.startsWith("releaseDate:"));
  const end = lines.at(-1) === "" ? lines.length - 1 : lines.length;
  lines.splice(at >= 0 ? at + 1 : end, 0, `stagingPercentage: ${percent}`);
  return lines.join("\n");
}

export const feedVersion = (yml: string | null) =>
  /^version:\s*(\S+)/m.exec(yml ?? "")?.[1] ?? null;

/**
 * Publishes a new build's feed: canary users get it at once; everyone else starts at 5%.
 * The previous `latest` feed is kept beside it, so a rollback can restore it.
 */
export async function publishCandidate(store: FeedStore, builtFeeds: Record<string, string>) {
  for (const [file, content] of Object.entries(builtFeeds)) {
    const previous = await store.read(file);
    if (previous !== null && feedVersion(previous) !== feedVersion(content))
      await store.write(`previous-${file}`, previous);
    await store.write(file.replace(/^latest/, "canary"), withStaging(content, 100));
    await store.write(file, withStaging(content, STAGES[0]));
  }
}

export async function setStage(store: FeedStore, percent: number) {
  for (const file of feedFiles("latest")) {
    const yml = await store.read(file);
    if (yml !== null) await store.write(file, withStaging(yml, percent));
  }
}

/**
 * Stops a bad version from spreading: everyone's feed goes back to the last good version, so no
 * new install receives the bad one. Installs that already updated get the fix-of-the-fix as a newer
 * version (the revert build), because Gente never installs an older version over a newer one.
 */
export async function rollBack(store: FeedStore) {
  for (const file of feedFiles("latest")) {
    const previous = await store.read(`previous-${file}`);
    if (previous !== null) {
      await store.write(file, withStaging(previous, 100));
      await store.write(file.replace(/^latest/, "canary"), withStaging(previous, 100));
    } else {
      const yml = await store.read(file);
      if (yml !== null) await store.write(file, withStaging(yml, 0));
    }
  }
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// One failure group, end to end: detect → reproduce → fix → pull request → gates → canary →
// 5% → 25% → 100%, with an automatic rollback when the health numbers drop. Every step is
// written to a run record that the status page shows.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepairAgent, Repo } from "./agent.js";
import { git, repair } from "./agent.js";
import type { Gate, GateResult } from "./gates.js";
import { gatesPassed, runGates } from "./gates.js";
import type { Cluster } from "./intake.js";
import type { Decision, FeedStore, RolloutPolicy, Stage, VersionMetrics } from "./rollout.js";
import { decide, publishCandidate, rollBack, STAGES, setStage } from "./rollout.js";

export type StepName =
  | "detect"
  | "reproduce"
  | "fix"
  | "pull-request"
  | "gates"
  | "canary"
  | "rollout";
export type Step = {
  name: StepName;
  status: "done" | "failed" | "skipped";
  at: string;
  detail: string;
};

export type RunRecord = {
  signature: string;
  code: string;
  title: string;
  runners: string[];
  reports: number;
  versions: string[];
  agent: string;
  steps: Step[];
  pullRequest?: {
    branch: string;
    base: string;
    title: string;
    body: string;
    patchFile: string;
    url?: string;
  };
  gates: GateResult[];
  rollout: {
    stage: Stage;
    decision: Decision;
    candidate: VersionMetrics;
    baseline: VersionMetrics;
  }[];
  outcome: "rolled-out" | "rolled-back" | "stopped";
  candidateVersion: string;
};

export type PipelineDeps = {
  cluster: Cluster;
  title: string;
  agent: RepairAgent;
  repo: Repo;
  gates: (testFile: string) => Gate[];
  mode: "ci" | "dry-run";
  feed: FeedStore;
  /** The feed files the candidate build produced (latest.yml, latest-mac.yml). */
  builtFeeds: Record<string, string>;
  candidateVersion: string;
  /** The health numbers of the candidate and the version before it, at a stage. */
  metrics: (
    stage: Stage,
  ) => Promise<{ candidate: VersionMetrics; baseline: VersionMetrics; hoursAtStage: number }>;
  policy?: RolloutPolicy;
  outDir: string;
  /** Opens a real pull request in CI; the dry run only writes it to disk. */
  openPullRequest?: (pr: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }) => Promise<string>;
};

const now = () => new Date().toISOString();

export async function healCluster(deps: PipelineDeps): Promise<RunRecord> {
  const { cluster } = deps;
  const record: RunRecord = {
    signature: cluster.signature,
    code: cluster.code,
    title: deps.title,
    runners: cluster.runners,
    reports: cluster.reports,
    versions: cluster.versions,
    agent: deps.agent.name,
    steps: [],
    gates: [],
    rollout: [],
    outcome: "stopped",
    candidateVersion: deps.candidateVersion,
  };
  const step = (name: StepName, status: Step["status"], detail: string) =>
    record.steps.push({ name, status, at: now(), detail });
  const save = () =>
    writeFile(path.join(deps.outDir, `${cluster.signature}.json`), JSON.stringify(record, null, 2));

  step(
    "detect",
    "done",
    `${cluster.reports} reports, ${cluster.platforms.join(" + ")}, versions ${cluster.versions.join(", ")}; runs on ${cluster.runners.join(" and ")}`,
  );

  const result = await repair(deps.agent, cluster, deps.repo);
  if (!result.ok) {
    step(result.step, "failed", result.reason);
    await save();
    return record;
  }
  step(
    "reproduce",
    "done",
    `${result.testFile} fails before the fix: ${firstLine(result.failingOutput)}`,
  );
  step("fix", "done", `${result.files.join(", ")} changed; the test passes and was not edited`);

  const branch = `self-heal/${cluster.signature}`;
  await git(deps.repo.dir, "branch", "-f", branch, "HEAD");
  const patchFile = path.join(deps.outDir, `${cluster.signature}.patch`);
  await writeFile(patchFile, result.diff);
  const body = [
    "## What",
    `Fixes ${cluster.code}, reported automatically by ${cluster.reports} Gente installs (${cluster.platforms.join(", ")}).`,
    "",
    "## Why",
    `People hit this on versions ${cluster.versions.join(", ")}. Reports are redacted: no chats, no personal data.`,
    "",
    "## Tested",
    `${result.testFile} reproduces the failure (fails before, passes after). The gates run the full tests, the packaged-app smoke test and the chaos subset.`,
    "",
    `Signature: \`${cluster.signature}\``,
  ].join("\n");
  const pr = { branch, base: "canary", title: `self-heal: ${deps.title}`, body };
  const url = deps.openPullRequest ? await deps.openPullRequest(pr) : undefined;
  record.pullRequest = { ...pr, patchFile: path.basename(patchFile), ...(url ? { url } : {}) };
  step("pull-request", "done", url ?? `${branch} → canary (dry run: not pushed)`);

  record.gates = await runGates(deps.gates(result.testFile));
  const verdict = gatesPassed(record.gates, deps.mode);
  step(
    "gates",
    verdict.ok ? "done" : "failed",
    record.gates.map((g) => `${g.gate} ${g.status}`).join(", "),
  );
  if (!verdict.ok) {
    await save();
    return record;
  }

  // Auto-merge into the canary branch (fast-forward only: exactly what the gates tested).
  await git(deps.repo.dir, "checkout", "-q", "canary");
  await git(deps.repo.dir, "merge", "-q", "--ff-only", branch);
  await publishCandidate(deps.feed, deps.builtFeeds);
  step(
    "canary",
    "done",
    `merged into canary; ${deps.candidateVersion} published to the canary channel and to 5% of everyone`,
  );

  let stage: Stage = STAGES[0];
  for (let guard = 0; guard < 20; guard++) {
    const metrics = await deps.metrics(stage);
    const decision = decide({ stage, ...metrics, policy: deps.policy });
    record.rollout.push({
      stage,
      decision,
      candidate: metrics.candidate,
      baseline: metrics.baseline,
    });
    if (decision.action === "rollback") {
      await rollBack(deps.feed);
      record.outcome = "rolled-back";
      step("rollout", "failed", `rolled back at ${stage}%: ${decision.reason}`);
      break;
    }
    if (decision.action === "done") {
      record.outcome = "rolled-out";
      step("rollout", "done", `100% of installs: ${decision.reason}`);
      break;
    }
    if (decision.action === "advance") {
      stage = decision.to;
      await setStage(deps.feed, stage);
    }
    // "hold": the next metrics read decides again (in CI, the next scheduled run).
    if (decision.action === "hold" && deps.mode === "ci") {
      step("rollout", "skipped", `holding at ${stage}%: ${decision.reason}`);
      break;
    }
  }
  const feedNow = await deps.feed.read("latest.yml");
  const last = record.steps.at(-1);
  if (last?.name === "rollout" && feedNow)
    last.detail += ` · feed now ${feedNow
      .split("\n")
      .filter((l) => /^(version|stagingPercentage):/.test(l))
      .join(", ")}`;
  await save();
  return record;
}

function firstLine(output: string) {
  const lines = output.split("\n");
  const line =
    lines.find((l) => /AssertionError|Expected/.test(l)) ??
    lines.find((l) => /not ok/.test(l)) ??
    lines[0] ??
    "";
  return line.trim().slice(0, 160);
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The pipeline's entry points for GitHub Actions (see .github/workflows/gente-self-heal.yml,
// gente-gates.yml and gente-rollout.yml). Each step is small and leaves a file the next reads.
//
//   tsx scripts/self-heal/cli.ts intake  --since <iso> [--dir <reports>] --out clusters.json
//   tsx scripts/self-heal/cli.ts repair  --clusters clusters.json --signature <sig>
//   tsx scripts/self-heal/cli.ts upload  --dir <builds>
//   tsx scripts/self-heal/cli.ts publish --built <folder> --feed <folder|cloud>
//   tsx scripts/self-heal/cli.ts rollout --feed <folder|cloud> [--apply]
//   tsx scripts/self-heal/cli.ts status  --records <folder> --out status.html
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { commandAgent, git, repair } from "./agent.js";
import { runCommand } from "./gates.js";
import type { Cluster } from "./intake.js";
import { bundlesFromCloud, bundlesFromDir, groupBySignature } from "./intake.js";
import type { RunRecord } from "./pipeline.js";
import type { FeedStore, Stage, VersionMetrics } from "./rollout.js";
import {
  decide,
  feedFiles,
  feedVersion,
  folderFeed,
  publishCandidate,
  rollBack,
  STAGES,
  setStage,
} from "./rollout.js";
import { renderStatusPage } from "./status-page.js";

const exec = promisify(execFile);

function arg(name: string, fallback?: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at > 0 ? process.argv[at + 1] : undefined;
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${name} is required`);
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

/**
 * Gente Cloud's self-heal service (cloud/supabase/functions/gente-selfheal on the cloud branch):
 * GENTE_SELFHEAL_URL is the function, SELF_HEAL_CLOUD_TOKEN the CI token it checks.
 */
const cloud = (route: string, init: RequestInit = {}) =>
  fetch(`${env("GENTE_SELFHEAL_URL")}${route}`, {
    ...init,
    headers: { authorization: `Bearer ${env("SELF_HEAL_CLOUD_TOKEN")}`, ...(init.headers ?? {}) },
  });

/**
 * The update feed in Gente Cloud's storage bucket: read through its public address
 * (GENTE_UPDATE_URL), written through the self-heal service.
 */
function cloudFeed(): FeedStore {
  return {
    read: async (file) => {
      const res = await fetch(`${env("GENTE_UPDATE_URL")}/${file}?t=${Date.now()}`);
      return res.ok ? res.text() : null;
    },
    write: async (file, content) => {
      const res = await cloud(`/feed/${file}`, { method: "PUT", body: content });
      if (!res.ok) throw new Error(`feed write ${file} answered ${res.status}`);
    },
  };
}

async function versionMetrics(version: string): Promise<VersionMetrics> {
  const res = await cloud(`/metrics?version=${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error(`metrics answered ${res.status}`);
  const row = ((await res.json()) as Record<string, string | number>[])[0];
  // Postgres counts arrive as strings.
  const n = (v: string | number | undefined) => Number(v ?? 0);
  return {
    version,
    launches: n(row?.launches),
    crashes: n(row?.crashes),
    setupOk: n(row?.setup_ok),
    setupFail: n(row?.setup_fail),
  };
}

const feedFor = (where: string) => (where === "cloud" ? cloudFeed() : folderFeed(where));

/** When the current stage started, kept next to the feed. */
type RolloutState = { version: string; stage: number; since: string };
async function writeState(feed: FeedStore, state: RolloutState) {
  await feed.write("rollout.json", `${JSON.stringify(state, null, 2)}\n`);
}

/** Opens (or finds) the issue for a failure group that has no repair agent yet. */
async function blockedIssue(cluster: Cluster, testNote: string) {
  const title = `self-heal: ${cluster.code} (${cluster.signature})`;
  const { stdout: existing } = await exec("gh", [
    "issue",
    "list",
    "--label",
    "self-heal",
    "--state",
    "open",
    "--search",
    cluster.signature,
    "--json",
    "url",
    "-q",
    ".[0].url",
  ]);
  if (existing.trim()) return existing.trim();
  const body = [
    `${cluster.reports} Gente installs reported \`${cluster.code}\` on ${cluster.platforms.join(", ")} (versions ${cluster.versions.join(", ")}).`,
    "",
    "**Blocked on owner:** the repair agent has no key yet, so the pipeline stops here. With `vars.SELF_HEAL_AGENT` and its key set, the next run writes the failing test and a proposed fix as a pull request.",
    "",
    testNote,
    "",
    "Redacted evidence (no chats, no personal data):",
    "```json",
    JSON.stringify(
      {
        message: cluster.message,
        stack: cluster.stack,
        health: cluster.sample.health,
        logs: cluster.sample.logs,
      },
      null,
      2,
    ).slice(0, 6000),
    "```",
    "",
    `Signature: \`${cluster.signature}\``,
  ].join("\n");
  const { stdout } = await exec("gh", [
    "issue",
    "create",
    "--label",
    "self-heal",
    "--label",
    "blocked-on-owner",
    "--title",
    title,
    "--body",
    body,
  ]);
  return stdout.trim();
}

const commands: Record<string, () => Promise<number>> = {
  async intake() {
    const bundles = process.argv.includes("--dir")
      ? await bundlesFromDir(arg("dir"))
      : await bundlesFromCloud(
          env("GENTE_SELFHEAL_URL"),
          env("SELF_HEAL_CLOUD_TOKEN"),
          arg("since"),
        );
    const clusters = groupBySignature(bundles).slice(0, Number(arg("limit", "5")));
    await writeFile(arg("out"), JSON.stringify(clusters, null, 2));
    // One repair job per failure group and OS, for the workflow's matrix.
    const matrix = clusters.flatMap((c) =>
      c.runners.map((runner) => ({ signature: c.signature, runner })),
    );
    console.log(JSON.stringify({ include: matrix }));
    return 0;
  },

  async repair() {
    const clusters = JSON.parse(await readFile(arg("clusters"), "utf8")) as Cluster[];
    const cluster = clusters.find((c) => c.signature === arg("signature"));
    if (!cluster) throw new Error("no such signature");
    const dir = process.cwd();
    if (!process.env.SELF_HEAL_AGENT) {
      // No repair agent key yet: record the group as an issue and stop (blocked on owner).
      const url = await blockedIssue(cluster, "No failing test yet: writing one needs the agent.");
      const now = new Date().toISOString();
      const record: RunRecord = {
        signature: cluster.signature,
        code: cluster.code,
        title: "Blocked on owner: the repair agent has no key yet",
        runners: cluster.runners,
        reports: cluster.reports,
        versions: cluster.versions,
        agent: "none (blocked-on-owner)",
        steps: [
          {
            name: "detect",
            status: "done",
            at: now,
            detail: `${cluster.reports} reports on ${cluster.platforms.join(" + ")}, versions ${cluster.versions.join(", ")}`,
          },
          {
            name: "reproduce",
            status: "skipped",
            at: now,
            detail: `blocked-on-owner: needs the repair agent key. Issue: ${url}`,
          },
        ],
        gates: [],
        rollout: [],
        outcome: "stopped",
        candidateVersion: "",
      };
      await writeFile(`repair-${cluster.signature}.json`, JSON.stringify(record, null, 2));
      console.log(`blocked-on-owner: ${url}`);
      return 0;
    }
    const branch = `self-heal/${cluster.signature}-${process.platform}`;
    await git(dir, "checkout", "-q", "-B", branch);
    const agent = commandAgent(env("SELF_HEAL_AGENT"), "apps/desktop/src/main");
    const result = await repair(agent, cluster, {
      dir,
      runTest: (file) => runCommand(["pnpm", "exec", "vitest", "run", file], dir),
    });
    await writeFile(`repair-${cluster.signature}.json`, JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.log(`stopped at ${result.step}: ${result.reason}`);
      return 1;
    }
    await git(dir, "push", "-f", "origin", branch);
    const body = `## What\nFixes ${cluster.code}, reported by ${cluster.reports} Gente installs (${cluster.platforms.join(", ")}).\n\n## Why\nSeen on versions ${cluster.versions.join(", ")}. Reports are redacted: no chats, no personal data.\n\n## Tested\n\`${result.testFile}\` failed before the fix and passes after it; the gates run next.\n\nSignature: \`${cluster.signature}\``;
    const { stdout } = await exec("gh", [
      "pr",
      "create",
      "--base",
      "canary",
      "--head",
      branch,
      "--label",
      "self-heal",
      "--title",
      `self-heal: ${cluster.code} (${cluster.signature})`,
      "--body",
      body,
    ]);
    console.log(stdout.trim());
    return 0;
  },

  /** Uploads every build file in a folder to the update bucket (signed upload, file by file). */
  async upload() {
    const dir = arg("dir");
    for (const file of (await readdir(dir)).filter((f) => !f.endsWith(".yml"))) {
      const signed = await cloud("/feed/upload-url", {
        method: "POST",
        body: JSON.stringify({ path: file }),
      });
      const { url } = (await signed.json()) as { url?: string };
      if (!url) throw new Error(`no upload address for ${file} (${signed.status})`);
      const put = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: await readFile(path.join(dir, file)),
      });
      if (put.status === 413)
        throw new Error(
          `blocked-on-owner: ${file} is larger than the storage upload limit; raise it in Supabase → Storage → Settings`,
        );
      if (!put.ok) throw new Error(`upload ${file} answered ${put.status}`);
      console.log(`uploaded ${file}`);
    }
    return 0;
  },

  async publish() {
    const feed = feedFor(arg("feed"));
    const built: Record<string, string> = {};
    for (const file of feedFiles("latest"))
      built[file] = await readFile(path.join(arg("built"), file), "utf8");
    await publishCandidate(feed, built);
    const version = feedVersion(built["latest.yml"] ?? null) ?? "unknown";
    await writeState(feed, { version, stage: STAGES[0], since: new Date().toISOString() });
    console.log(`published ${version}: canary channel 100%, everyone else ${STAGES[0]}%`);
    return 0;
  },

  async rollout() {
    const feed = feedFor(arg("feed"));
    const current = await feed.read("latest.yml");
    const previous = await feed.read("previous-latest.yml");
    const version = feedVersion(current);
    const baselineVersion = feedVersion(previous);
    if (!version || !baselineVersion || version === baselineVersion) {
      console.log("nothing is rolling out");
      return 0;
    }
    const stage = Number(/^stagingPercentage:\s*(\d+)/m.exec(current ?? "")?.[1] ?? 100) as Stage;
    const state = JSON.parse((await feed.read("rollout.json")) ?? "{}") as Partial<RolloutState>;
    const since = Date.parse(
      state.version === version && state.since ? state.since : new Date().toISOString(),
    );
    const decision = decide({
      stage: STAGES.includes(stage) ? stage : 100,
      hoursAtStage: Math.floor((Date.now() - since) / 3_600_000),
      candidate: await versionMetrics(version),
      baseline: await versionMetrics(baselineVersion),
    });
    console.log(JSON.stringify({ version, stage, decision }));
    if (!flag("apply")) return 0;
    if (decision.action === "advance") {
      await setStage(feed, decision.to);
      await writeState(feed, { version, stage: decision.to, since: new Date().toISOString() });
    }
    if (decision.action === "rollback") {
      await rollBack(feed);
      return 3; // the workflow reverts the merge on canary, which builds and ships a newer, good version
    }
    return 0;
  },

  async status() {
    const dir = arg("records");
    const records: RunRecord[] = [];
    for (const file of (await readdir(dir)).filter(
      (f) => f.endsWith(".json") && !f.startsWith("clusters"),
    ))
      try {
        const parsed = JSON.parse(await readFile(path.join(dir, file), "utf8")) as RunRecord;
        if (parsed.signature && parsed.steps) records.push(parsed);
      } catch {
        // Not a run record.
      }
    await writeFile(
      arg("out"),
      renderStatusPage({ records, generatedAt: new Date().toISOString(), mode: "Live" }),
    );
    return 0;
  },
};

const name = process.argv[2] ?? "";
const command = commands[name];
if (!command) {
  console.error(`usage: cli.ts ${Object.keys(commands).join("|")} …`);
  process.exit(2);
}
process.exit(await command());

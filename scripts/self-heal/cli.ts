// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The pipeline's entry points for GitHub Actions (see .github/workflows/gente-self-heal.yml,
// gente-gates.yml and gente-rollout.yml). Each step is small and leaves a file the next reads.
//
//   tsx scripts/self-heal/cli.ts intake  --since <iso> [--dir <reports>] --out clusters.json
//   tsx scripts/self-heal/cli.ts repair  --clusters clusters.json --signature <sig>
//   tsx scripts/self-heal/cli.ts publish --built <folder> --feed <folder|s3://bucket/path>
//   tsx scripts/self-heal/cli.ts rollout --feed <folder|s3://bucket/path> [--apply]
//   tsx scripts/self-heal/cli.ts status  --records <folder> --out status.html
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { commandAgent, git, repair } from "./agent.js";
import { runCommand } from "./gates.js";
import type { Cluster } from "./intake.js";
import { bundlesFromDir, bundlesFromTable, groupBySignature } from "./intake.js";
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

/** An update feed in an S3-compatible bucket, through the aws command line (preinstalled on runners). */
function bucketFeed(url: string): FeedStore {
  const endpoint = process.env.GENTE_UPDATE_ENDPOINT
    ? ["--endpoint-url", process.env.GENTE_UPDATE_ENDPOINT]
    : [];
  return {
    read: async (file) => {
      try {
        return (await exec("aws", ["s3", "cp", ...endpoint, `${url}/${file}`, "-"])).stdout;
      } catch {
        return null;
      }
    },
    write: async (file, content) => {
      const tmp = path.join(await mkdtemp(path.join(os.tmpdir(), "feed-")), file);
      await writeFile(tmp, content);
      await exec("aws", [
        "s3",
        "cp",
        ...endpoint,
        tmp,
        `${url}/${file}`,
        "--cache-control",
        "no-cache",
      ]);
    },
  };
}

async function versionMetrics(version: string): Promise<VersionMetrics> {
  const res = await fetch(
    `${env("GENTE_SUPABASE_URL")}/rest/v1/gente_version_metrics?version=eq.${encodeURIComponent(version)}`,
    {
      headers: {
        apikey: env("GENTE_SUPABASE_SERVICE_KEY"),
        authorization: `Bearer ${env("GENTE_SUPABASE_SERVICE_KEY")}`,
      },
    },
  );
  if (!res.ok) throw new Error(`metrics answered ${res.status}`);
  const row = ((await res.json()) as Record<string, number>[])[0];
  return {
    version,
    launches: row?.launches ?? 0,
    crashes: row?.crashes ?? 0,
    setupOk: row?.setup_ok ?? 0,
    setupFail: row?.setup_fail ?? 0,
  };
}

const feedFor = (url: string) => (url.startsWith("s3://") ? bucketFeed(url) : folderFeed(url));

/** When the current stage started, kept next to the feed. */
type RolloutState = { version: string; stage: number; since: string };
async function writeState(feed: FeedStore, state: RolloutState) {
  await feed.write("rollout.json", `${JSON.stringify(state, null, 2)}\n`);
}

const commands: Record<string, () => Promise<number>> = {
  async intake() {
    const bundles = process.argv.includes("--dir")
      ? await bundlesFromDir(arg("dir"))
      : await bundlesFromTable({
          url: env("GENTE_SUPABASE_URL"),
          serviceKey: env("GENTE_SUPABASE_SERVICE_KEY"),
          since: arg("since"),
        });
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

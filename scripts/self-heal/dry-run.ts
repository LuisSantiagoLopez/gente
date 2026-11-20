// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The end-to-end dry run: five real error types go detect → reproduce → fix → PR → gates →
// canary → 5% → 25% → 100%, plus one drill where the health numbers drop and the rollout rolls
// back by itself. Nothing is pushed and no feed outside the output folder is touched.
//
//   pnpm exec tsx scripts/self-heal/dry-run.ts [outDir]
//
// What is real here: the health checks and redaction that make each report, the grouping, the
// git sandbox with the buggy module, the failing-then-passing test, the safety checks on the
// agent, the unit tests and chaos gates, and the feed files the rollout edits. What is simulated:
// the agent (it replays known fixes), the packaged-app smoke gate (needs a CI build), and the
// health numbers each rollout stage reads.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CaughtError } from "../../apps/desktop/src/main/support/diagnostics.js";
import { buildDiagnosticsBundle } from "../../apps/desktop/src/main/support/diagnostics.js";
import type { HealthProbe } from "../../apps/desktop/src/main/support/health.js";
import { runHealthChecks } from "../../apps/desktop/src/main/support/health.js";
import { failureSignature } from "../../apps/desktop/src/main/support/signature.js";
import type { Repo } from "./agent.js";
import { git, playbookAgent } from "./agent.js";
import { runChaos } from "./chaos.js";
import type { Gate } from "./gates.js";
import type { Cluster } from "./intake.js";
import { bundlesFromDir, groupBySignature } from "./intake.js";
import type { RunRecord } from "./pipeline.js";
import { healCluster } from "./pipeline.js";
import { PLAYBOOKS } from "./playbooks.js";
import type { VersionMetrics } from "./rollout.js";
import { folderFeed } from "./rollout.js";
import { renderStatusPage } from "./status-page.js";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** One user-side fault: how each computer's health checks see it and the error it logged. */
const FAULTS: {
  code: keyof typeof PLAYBOOKS;
  probe: Partial<HealthProbe>;
  error: (home: string, port: number) => { message: string; stack?: string; source: string };
}[] = [
  {
    code: "BUNDLE_MODULE_MISSING",
    probe: { missingAppFiles: async () => ["module pg-native"] },
    error: (home) => ({
      source: "health",
      message: `missing: module pg-native`,
      stack: `Error: Cannot find module 'pg-native'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)\n    at Object.<anonymous> (${home}/Applications/Gente.app/Contents/Resources/rakazo-server/api/index.js:4:12)`,
    }),
  },
  {
    code: "OLLAMA_DOWN",
    probe: { ollamaUp: async () => false },
    error: () => ({
      source: "health",
      message: "Gente's model server stopped. Restarting it usually fixes this.",
    }),
  },
  {
    code: "DISK_LOW",
    probe: { freeDiskBytes: async () => 0.8e9 },
    error: (home) => ({
      source: "setup",
      message: `pull hf.co/ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ2_XXS attempt 1: write ${home}/.ollama/models/blobs/sha256-partial: no space left on device`,
    }),
  },
  {
    code: "PORT_IN_USE",
    probe: { portConflict: async () => ({ port: 3000, heldByOther: true }) },
    error: (_home, port) => ({ source: "health", message: `port ${port} held by another process` }),
  },
  {
    code: "MODEL_CORRUPT",
    probe: { modelError: async () => 'show 500: {"error":"invalid file magic"}' },
    error: () => ({ source: "health", message: 'show 500: {"error":"invalid file magic"}' }),
  },
];

const healthy: HealthProbe = {
  version: "0.2.0",
  platform: "darwin",
  ollamaUp: async () => true,
  ollamaTags: async () => ["swift-1.5-27b:latest"],
  modelError: async () => null,
  modelAlias: async () => "swift-1.5-27b",
  freeDiskBytes: async () => 80e9,
  portConflict: async () => null,
  missingAppFiles: async () => [],
  workspacePhase: () => "ready",
  telegramLinked: async () => null,
};

/** Reports from several "computers" (Mac and Windows, different people, ports and folders). */
async function makeReports(dir: string) {
  await mkdir(dir, { recursive: true });
  const people = [
    { home: "/Users/maria", platform: "darwin", port: 3000 },
    { home: "/Users/joao.silva", platform: "darwin", port: 3001 },
    { home: "C:\\Users\\Carlos", platform: "win32", port: 3000 },
  ];
  let n = 0;
  for (const fault of FAULTS) {
    for (const person of people) {
      const health = await runHealthChecks({
        ...healthy,
        platform: person.platform,
        ...fault.probe,
      });
      const err = fault.error(person.home, person.port);
      const message = err.message;
      const caught: CaughtError = {
        at: new Date(Date.UTC(2026, 10, 19, 9, n)).toISOString(),
        code: fault.code,
        source: err.source,
        message,
        ...(err.stack ? { stack: err.stack } : {}),
        signature: "",
      };
      const bundle = buildDiagnosticsBundle({
        version: "0.2.0",
        channel: "latest",
        os: {
          platform: person.platform,
          release: person.platform === "win32" ? "10.0.26100" : "25.6.0",
          arch: "arm64",
          totalMemBytes: 16 * 1024 ** 3,
        },
        health,
        errors: [caught],
        logs: { "setup.log": [`2026-11-19T09:0${n % 10}:00Z ${message}`] },
        context: { homeDir: person.home },
      });
      // The app computes the signature after redaction, so every computer's report matches.
      for (const failure of bundle.failures)
        failure.signature = failureSignature({
          code: failure.code,
          source: failure.source,
          message: failure.message,
          stack: failure.stack,
        });
      await writeFile(
        path.join(dir, `report-${String(++n).padStart(2, "0")}.json`),
        JSON.stringify(bundle, null, 2),
      );
    }
  }
  return n;
}

async function sandboxRepo(cluster: Cluster): Promise<Repo> {
  const book = PLAYBOOKS[cluster.code];
  if (!book) throw new Error(`no playbook for ${cluster.code}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), `gente-heal-${cluster.code.toLowerCase()}-`));
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.email", "self-heal@example.invalid");
  await git(dir, "config", "user.name", "Gente self-heal (dry run)");
  await mkdir(path.dirname(path.join(dir, book.target.path)), { recursive: true });
  await writeFile(path.join(dir, book.target.path), book.target.before);
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}\n');
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "Gente as shipped (with the bug)");
  await git(dir, "branch", "canary");
  await git(dir, "checkout", "-q", "-b", "work");
  return {
    dir,
    runTest: async (testFile) => {
      try {
        const { stdout, stderr } = await exec(process.execPath, ["--test", testFile], { cwd: dir });
        return { code: 0, output: stdout + stderr };
      } catch (error) {
        const e = error as { code?: number; stdout?: string; stderr?: string };
        return {
          code: typeof e.code === "number" ? e.code : 1,
          output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
        };
      }
    },
  };
}

const feedYml = (version: string) =>
  `version: ${version}\nfiles:\n  - url: Gente-${version}-arm64-mac.zip\n    sha512: dry-run\npath: Gente-${version}-arm64-mac.zip\nsha512: dry-run\nreleaseDate: '2026-11-19T00:00:00.000Z'\n`;

const BASELINE: VersionMetrics = {
  version: "0.2.0",
  launches: 10_000,
  crashes: 80,
  setupOk: 950,
  setupFail: 50,
};
const HEALTHY_STAGES: Record<number, VersionMetrics> = {
  5: { version: "", launches: 420, crashes: 2, setupOk: 48, setupFail: 2 },
  25: { version: "", launches: 2_150, crashes: 11, setupOk: 236, setupFail: 9 },
  100: { version: "", launches: 9_300, crashes: 49, setupOk: 961, setupFail: 33 },
};
const BAD_AT_25: VersionMetrics = {
  version: "",
  launches: 2_040,
  crashes: 71,
  setupOk: 201,
  setupFail: 39,
};

export async function dryRun(outDir: string) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const reportsDir = path.join(outDir, "reports");
  const reportCount = await makeReports(reportsDir);
  const clusters = groupBySignature(await bundlesFromDir(reportsDir));
  await writeFile(
    path.join(outDir, "clusters.json"),
    JSON.stringify(
      clusters.map(({ sample: _s, ...c }) => c),
      null,
      2,
    ),
  );
  console.log(`${reportCount} reports → ${clusters.length} failure groups`);

  const chaos = await runChaos();
  await writeFile(path.join(outDir, "chaos.json"), JSON.stringify(chaos, null, 2));

  const drill: Cluster | undefined = clusters.find((c) => c.code === "PORT_IN_USE");
  const runs: { cluster: Cluster; badMetrics: boolean }[] = [
    ...clusters.map((cluster) => ({ cluster, badMetrics: false })),
    ...(drill
      ? [{ cluster: { ...drill, signature: `${drill.signature}-drill` }, badMetrics: true }]
      : []),
  ];
  const records: RunRecord[] = [];
  let patch = 1;
  for (const { cluster, badMetrics } of runs) {
    const book = PLAYBOOKS[cluster.code];
    if (!book) continue;
    const version = `0.2.${patch++}`;
    const repo = await sandboxRepo(cluster);
    const feedDir = path.join(outDir, "feeds", cluster.signature);
    const feed = folderFeed(feedDir);
    await feed.write("latest.yml", feedYml("0.2.0"));
    await feed.write("latest-mac.yml", feedYml("0.2.0"));
    const gates = (testFile: string): Gate[] => [
      { gate: "reproduce-test", command: [process.execPath, "--test", testFile], cwd: repo.dir },
      {
        gate: "full-tests",
        command: [
          "pnpm",
          "exec",
          "vitest",
          "run",
          "apps/desktop/src/main/support",
          "scripts/self-heal",
        ],
        cwd: ROOT,
      },
      {
        gate: "packaged-smoke",
        command: ["node", "apps/desktop/e2e/burrow-windows-smoke.mjs"],
        cwd: ROOT,
        simulate: `needs a packaged build; CI runs it on ${cluster.runners.join(" and ")} (gente-gates.yml)`,
      },
      { gate: "chaos", command: ["pnpm", "exec", "tsx", "scripts/self-heal/chaos.ts"], cwd: ROOT },
    ];
    const record = await healCluster({
      cluster,
      title: badMetrics ? `${book.title} (rollback drill: this build crashes more)` : book.title,
      agent: playbookAgent,
      repo,
      gates,
      mode: "dry-run",
      feed,
      builtFeeds: { "latest.yml": feedYml(version), "latest-mac.yml": feedYml(version) },
      candidateVersion: version,
      metrics: async (stage) => ({
        candidate: {
          ...(badMetrics && stage === 25 ? BAD_AT_25 : (HEALTHY_STAGES[stage] as VersionMetrics)),
          version,
        },
        baseline: BASELINE,
        hoursAtStage: 24,
      }),
      outDir,
    });
    records.push(record);
    console.log(
      `${record.outcome.padEnd(11)} ${cluster.code.padEnd(22)} ${record.steps.map((s) => `${s.name}:${s.status}`).join(" ")}`,
    );
    await rm(repo.dir, { recursive: true, force: true });
  }
  await writeFile(path.join(outDir, "records.json"), JSON.stringify(records, null, 2));
  await writeFile(
    path.join(outDir, "status.html"),
    renderStatusPage({ records, generatedAt: new Date().toISOString(), mode: "Dry run", chaos }),
  );
  return { reportCount, clusters, records, chaos };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const out = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "gente-self-heal-dry-run"));
  const result = await dryRun(out);
  const shipped = result.records.filter((r) => r.outcome === "rolled-out").length;
  const rolledBack = result.records.filter((r) => r.outcome === "rolled-back").length;
  console.log(
    `\n${shipped} shipped to 100%, ${rolledBack} rolled back. Status page: ${path.join(out, "status.html")}`,
  );
  process.exit(shipped === 5 && rolledBack === 1 ? 0 : 1);
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagnosticsBundle } from "../../apps/desktop/src/main/support/diagnostics.js";
import type { RepairAgent, Repo } from "./agent.js";
import { git, repair } from "./agent.js";
import type { GateResult } from "./gates.js";
import { gatesPassed } from "./gates.js";
import type { Cluster } from "./intake.js";
import { groupBySignature, runnersFor } from "./intake.js";
import { PLAYBOOKS } from "./playbooks.js";
import {
  decide,
  folderFeed,
  publishCandidate,
  rollBack,
  setStage,
  withAssetBase,
  withStaging,
} from "./rollout.js";

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

const bundle = (platform: string, signature: string, version = "0.2.0"): DiagnosticsBundle => ({
  schema: 1,
  id: "x",
  createdAt: "2026-11-19T00:00:00Z",
  app: { version, channel: "latest" },
  os: { platform, release: "1", arch: "arm64", memoryGB: 16 },
  codes: ["OLLAMA_DOWN"],
  failures: [
    {
      signature,
      code: "OLLAMA_DOWN",
      source: "health",
      count: 2,
      lastAt: "2026-11-19T00:00:00Z",
      message: "m",
    },
  ],
  health: [],
  logs: {},
});

describe("intake", () => {
  it("groups reports by signature and picks a runner per OS", () => {
    const clusters = groupBySignature([
      bundle("darwin", "A"),
      bundle("win32", "A", "0.2.1"),
      bundle("darwin", "B"),
    ]);
    expect(clusters.map((c) => [c.signature, c.reports, c.versions, c.runners])).toEqual([
      ["A", 4, ["0.2.0", "0.2.1"], ["macos-15", "windows-2025"]],
      ["B", 2, ["0.2.0"], ["macos-15"]],
    ]);
    expect(runnersFor(["win32"])).toEqual(["windows-2025"]);
  });
});

describe("repair safety checks", () => {
  const cluster = { code: "DISK_LOW", signature: "DISK_LOW-test" } as Cluster;
  const book = PLAYBOOKS.DISK_LOW!;
  async function sandbox(): Promise<Repo> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-repair-test-"));
    cleanup.push(dir);
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.email", "t@example.invalid");
    await git(dir, "config", "user.name", "t");
    await mkdir(path.join(dir, "brain"), { recursive: true });
    await writeFile(path.join(dir, book.target.path), book.target.before);
    await writeFile(path.join(dir, "package.json"), '{"type":"module"}\n');
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "base");
    return {
      dir,
      // A stand-in runner: the test "fails" while the module still has the bug.
      runTest: async () => {
        const source = await readFile(path.join(dir, book.target.path), "utf8");
        return source.includes("stats.bfree * stats.bsize")
          ? { code: 1, output: "not ok" }
          : { code: 0, output: "ok" };
      },
    };
  }
  const writeTest: RepairAgent["reproduce"] = async (_c, repo) => {
    await writeFile(path.join(repo.dir, book.test.path), book.test.content);
  };
  const writeFix: RepairAgent["fix"] = async (_c, repo) => {
    await writeFile(path.join(repo.dir, book.target.path), book.target.after);
  };

  it("accepts a failing test followed by a fix that leaves the test alone", async () => {
    const result = await repair(
      { name: "ok", reproduce: writeTest, fix: writeFix },
      cluster,
      await sandbox(),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a reproduce step that also changes code", async () => {
    const result = await repair(
      {
        name: "sneaky",
        reproduce: async (c, repo) => {
          await writeTest(c, repo);
          await writeFix(c, repo, "", "");
        },
        fix: writeFix,
      },
      cluster,
      await sandbox(),
    );
    expect(result).toMatchObject({ ok: false, step: "reproduce" });
  });

  it("rejects a test that passes before the fix", async () => {
    const repo = await sandbox();
    await writeFile(path.join(repo.dir, book.target.path), book.target.after);
    await git(repo.dir, "commit", "-qam", "already fixed");
    const result = await repair({ name: "x", reproduce: writeTest, fix: writeFix }, cluster, repo);
    expect(result).toMatchObject({ ok: false, step: "reproduce" });
  });

  it("rejects a fix that edits the reproducing test", async () => {
    const result = await repair(
      {
        name: "cheat",
        reproduce: writeTest,
        fix: async (c, repo) => {
          await writeFix(c, repo, "", "");
          await writeFile(path.join(repo.dir, book.test.path), "// deleted the assertion\n");
        },
      },
      cluster,
      await sandbox(),
    );
    expect(result).toMatchObject({
      ok: false,
      step: "fix",
      reason: "the fix changed the reproducing test",
    });
  });
});

describe("gates", () => {
  const all = (status: GateResult["status"]): GateResult[] =>
    (["reproduce-test", "full-tests", "packaged-smoke", "chaos"] as const).map((gate) => ({
      gate,
      status,
      command: "",
      seconds: 0,
      output: "",
    }));

  it("never lets a fix through with a gate missing, failed or only simulated in CI", () => {
    expect(gatesPassed(all("passed"), "ci").ok).toBe(true);
    expect(gatesPassed(all("passed").slice(1), "ci")).toEqual({
      ok: false,
      reason: "reproduce-test did not run",
    });
    expect(gatesPassed(all("failed"), "ci").ok).toBe(false);
    const simulatedSmoke = all("passed").map((g) =>
      g.gate === "packaged-smoke" ? { ...g, status: "simulated" as const } : g,
    );
    expect(gatesPassed(simulatedSmoke, "ci")).toEqual({
      ok: false,
      reason: "packaged-smoke was not run for real",
    });
    expect(gatesPassed(simulatedSmoke, "dry-run").ok).toBe(true);
  });
});

describe("staged rollout", () => {
  const baseline = { version: "0.2.0", launches: 10_000, crashes: 80, setupOk: 950, setupFail: 50 };
  const good = { version: "0.2.1", launches: 500, crashes: 2, setupOk: 48, setupFail: 2 };

  it("advances 5 → 25 → 100 on healthy numbers, then stops", () => {
    expect(decide({ stage: 5, hoursAtStage: 24, candidate: good, baseline })).toMatchObject({
      action: "advance",
      to: 25,
    });
    expect(decide({ stage: 25, hoursAtStage: 24, candidate: good, baseline })).toMatchObject({
      action: "advance",
      to: 100,
    });
    expect(decide({ stage: 100, hoursAtStage: 24, candidate: good, baseline })).toMatchObject({
      action: "done",
    });
  });

  it("holds without enough data or time", () => {
    expect(
      decide({
        stage: 5,
        hoursAtStage: 24,
        candidate: { ...good, launches: 120, crashes: 0 },
        baseline,
      }).action,
    ).toBe("hold");
    expect(decide({ stage: 5, hoursAtStage: 3, candidate: good, baseline }).action).toBe("hold");
  });

  it("rolls back when crashes or failed setups go up", () => {
    expect(
      decide({ stage: 25, hoursAtStage: 1, candidate: { ...good, crashes: 30 }, baseline }).action,
    ).toBe("rollback");
    expect(
      decide({
        stage: 25,
        hoursAtStage: 24,
        candidate: { ...good, setupOk: 40, setupFail: 10 },
        baseline,
      }).action,
    ).toBe("rollback");
  });

  it("edits the update feed: 5% first, staged up, restored on rollback", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gente-feed-test-"));
    cleanup.push(dir);
    const feed = folderFeed(dir);
    const yml = (v: string) => `version: ${v}\npath: Gente-${v}.zip\nreleaseDate: '2026-11-19'\n`;
    await feed.write("latest.yml", yml("0.2.0"));
    await publishCandidate(feed, { "latest.yml": yml("0.2.1") });
    expect(await feed.read("latest.yml")).toContain(
      "version: 0.2.1\npath: Gente-0.2.1.zip\nreleaseDate: '2026-11-19'\nstagingPercentage: 5",
    );
    expect(await feed.read("canary.yml")).toContain("stagingPercentage: 100");
    await setStage(feed, 25);
    expect(await feed.read("latest.yml")).toContain("stagingPercentage: 25");
    await rollBack(feed);
    expect(await feed.read("latest.yml")).toContain("version: 0.2.0");
    expect(withStaging("version: 1\nstagingPercentage: 5\n", 25)).toBe(
      "version: 1\nstagingPercentage: 25\n",
    );
  });
});

describe("installers on GitHub releases", () => {
  it("points feed files at the release and leaves absolute addresses alone", () => {
    const yml =
      "version: 0.2.9\nfiles:\n  - url: Gente-0.2.9-arm64-mac.zip\n    sha512: x\n  - url: https://a.example/b.zip\npath: Gente-0.2.9-arm64-mac.zip\n";
    expect(withAssetBase(yml, "https://github.com/o/r/releases/download/v0.2.9/")).toBe(
      "version: 0.2.9\nfiles:\n  - url: https://github.com/o/r/releases/download/v0.2.9/Gente-0.2.9-arm64-mac.zip\n    sha512: x\n  - url: https://a.example/b.zip\npath: https://github.com/o/r/releases/download/v0.2.9/Gente-0.2.9-arm64-mac.zip\n",
    );
  });
});

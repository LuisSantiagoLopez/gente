// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Step 2 and 3: an agent reproduces a failure as a failing test, then fixes it. The pipeline does
// not trust the agent: it checks that step 1 added only a test, that the test really fails, that
// step 2 left the test untouched, and that the test then passes.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Cluster } from "./intake.js";
import { PLAYBOOKS } from "./playbooks.js";
import { fixPrompt, reproducePrompt } from "./repair.prompt.js";

const run = promisify(execFile);

export type Repo = {
  dir: string;
  /** Runs one test file; resolves with its exit code and output. */
  runTest: (testFile: string) => Promise<{ code: number; output: string }>;
};

export type RepairAgent = {
  name: string;
  reproduce: (cluster: Cluster, repo: Repo) => Promise<void>;
  fix: (cluster: Cluster, repo: Repo, testFile: string, failure: string) => Promise<void>;
};

export async function git(dir: string, ...args: string[]) {
  const { stdout } = await run("git", args, { cwd: dir, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/** Files changed since the last commit, including new ones. */
export async function changedFiles(dir: string): Promise<{ added: string[]; modified: string[] }> {
  const lines = (await git(dir, "status", "--porcelain", "--untracked-files=all"))
    .split("\n")
    .filter(Boolean);
  const added: string[] = [];
  const modified: string[] = [];
  for (const line of lines) {
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (status === "??" || status.includes("A")) added.push(file);
    else modified.push(file);
  }
  return { added, modified };
}

export const isTestFile = (file: string) => /\.test\.(ts|mts|js|mjs)$/.test(file);

/** The dry run's agent: writes the known test and fix for each rehearsed failure. */
export const playbookAgent: RepairAgent = {
  name: "playbook (dry run)",
  async reproduce(cluster, repo) {
    const book = PLAYBOOKS[cluster.code];
    if (!book) throw new Error(`no playbook for ${cluster.code}`);
    await mkdir(path.dirname(path.join(repo.dir, book.test.path)), { recursive: true });
    await writeFile(path.join(repo.dir, book.test.path), book.test.content);
  },
  async fix(cluster, repo) {
    const book = PLAYBOOKS[cluster.code];
    if (!book) throw new Error(`no playbook for ${cluster.code}`);
    await writeFile(path.join(repo.dir, book.target.path), book.target.after);
  },
};

/**
 * A real agent: any command that reads a prompt on stdin and edits files in the working folder,
 * such as a CI coding agent or a script around the local model. Set SELF_HEAL_AGENT, for example
 * `claude -p --permission-mode acceptEdits`.
 */
export function commandAgent(command: string, testDir: string): RepairAgent {
  const [program, ...args] = command.split(/\s+/);
  const ask = (dir: string, prompt: string) =>
    new Promise<void>((resolve, reject) => {
      const child = execFile(
        program ?? "",
        args,
        { cwd: dir, maxBuffer: 50 * 1024 * 1024, timeout: 30 * 60_000 },
        (error) => (error ? reject(error) : resolve()),
      );
      child.stdin?.end(prompt);
    });
  return {
    name: `command: ${program}`,
    reproduce: (cluster, repo) => ask(repo.dir, reproducePrompt(cluster, testDir)),
    fix: (cluster, repo, testFile, failure) => ask(repo.dir, fixPrompt(cluster, testFile, failure)),
  };
}

export type RepairResult =
  | {
      ok: true;
      testFile: string;
      failingOutput: string;
      passingOutput: string;
      diff: string;
      files: string[];
    }
  | { ok: false; step: "reproduce" | "fix"; reason: string };

/** Runs both steps with every safety check. On success the repo holds two commits: the test, then the fix. */
export async function repair(
  agent: RepairAgent,
  cluster: Cluster,
  repo: Repo,
): Promise<RepairResult> {
  const base = (await git(repo.dir, "rev-parse", "HEAD")).trim();
  await agent.reproduce(cluster, repo);
  const step1 = await changedFiles(repo.dir);
  if (step1.modified.length > 0 || step1.added.length !== 1 || !isTestFile(step1.added[0] ?? ""))
    return {
      ok: false,
      step: "reproduce",
      reason: `step 1 must add exactly one test file; it changed ${[...step1.added, ...step1.modified].join(", ") || "nothing"}`,
    };
  const testFile = step1.added[0] as string;
  const before = await repo.runTest(testFile);
  if (before.code === 0)
    return {
      ok: false,
      step: "reproduce",
      reason: "the new test passes without a fix, so it does not reproduce the failure",
    };
  const testContent = await readFile(path.join(repo.dir, testFile), "utf8");
  await git(repo.dir, "add", testFile);
  await git(repo.dir, "commit", "-q", "-m", `test: reproduce ${cluster.signature}`);

  await agent.fix(cluster, repo, testFile, before.output);
  const step2 = await changedFiles(repo.dir);
  if (
    (await readFile(path.join(repo.dir, testFile), "utf8").catch(() => "")) !== testContent ||
    step2.modified.includes(testFile)
  )
    return { ok: false, step: "fix", reason: "the fix changed the reproducing test" };
  if (step2.added.length + step2.modified.length === 0)
    return { ok: false, step: "fix", reason: "the agent changed nothing" };
  const after = await repo.runTest(testFile);
  if (after.code !== 0)
    return {
      ok: false,
      step: "fix",
      reason: `the test still fails:\n${after.output.slice(0, 2000)}`,
    };
  await git(repo.dir, "add", "-A");
  await git(repo.dir, "commit", "-q", "-m", `fix: ${cluster.signature}`);
  const diff = await git(repo.dir, "diff", base, "HEAD");
  return {
    ok: true,
    testFile,
    failingOutput: before.output,
    passingOutput: after.output,
    diff,
    files: [...step2.added, ...step2.modified],
  };
}

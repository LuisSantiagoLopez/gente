// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The dry run's repair agent. For each of the five rehearsed failures it knows the buggy module
// (seeded into a sandbox repository), the failing test a repair agent should write, and the fix.
// The pipeline treats it exactly like a real agent: the test must fail before the fix, pass after,
// and the fix may not touch the test. Tests use node:test so the sandbox needs no packages.

export type Playbook = {
  code: string;
  title: string;
  /** The module as it is before the fix (seeded as the sandbox's starting commit). */
  target: { path: string; before: string; after: string };
  test: { path: string; content: string };
};

export const PLAYBOOKS: Record<string, Playbook> = {
  BUNDLE_MODULE_MISSING: {
    code: "BUNDLE_MODULE_MISSING",
    title: "Bundle every package the server imports (pg-native was left out)",
    target: {
      path: "server-bundle/runtime-packages.ts",
      before: `/** Packages copied into the app's server bundle. */
export const RUNTIME_PACKAGES = ["@prisma/client", "pg", "graphile-worker"];

export function missingFromBundle(imports: readonly string[]): string[] {
  return imports.filter((name) => !RUNTIME_PACKAGES.includes(name));
}
`,
      after: `/** Packages copied into the app's server bundle. */
export const RUNTIME_PACKAGES = ["@prisma/client", "pg", "pg-native", "graphile-worker"];

export function missingFromBundle(imports: readonly string[]): string[] {
  return imports.filter((name) => !RUNTIME_PACKAGES.includes(name));
}
`,
    },
    test: {
      path: "server-bundle/runtime-packages.test.ts",
      content: `import assert from "node:assert/strict";
import { test } from "node:test";
import { missingFromBundle } from "./runtime-packages.ts";

// Reports: "Cannot find module 'pg-native'" in api.log on a fresh install.
test("every package the server imports is in the bundle", () => {
  assert.deepEqual(missingFromBundle(["pg", "pg-native", "graphile-worker"]), []);
});
`,
    },
  },
  OLLAMA_DOWN: {
    code: "OLLAMA_DOWN",
    title: "Restart the model server when Ollama was installed without its app",
    target: {
      path: "brain/recover-model-server.ts",
      before: `export type RecoverDeps = {
  up: () => Promise<boolean>;
  appPath: string | null;
  cliPath: string | null;
  start: (program: string) => Promise<void>;
};

export async function recoverModelServer(deps: RecoverDeps): Promise<boolean> {
  if (await deps.up()) return true;
  if (deps.appPath === null) return false;
  await deps.start(deps.appPath);
  return deps.up();
}
`,
      after: `export type RecoverDeps = {
  up: () => Promise<boolean>;
  appPath: string | null;
  cliPath: string | null;
  start: (program: string) => Promise<void>;
};

export async function recoverModelServer(deps: RecoverDeps): Promise<boolean> {
  if (await deps.up()) return true;
  // Ollama installed from a package manager has a command but no app; start whichever exists.
  const program = deps.appPath ?? deps.cliPath;
  if (program === null) return false;
  await deps.start(program);
  return deps.up();
}
`,
    },
    test: {
      path: "brain/recover-model-server.test.ts",
      content: `import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverModelServer } from "./recover-model-server.ts";

// Reports: OLLAMA_DOWN stays failed after the automatic restart on computers with only the ollama command.
test("starts the ollama command when there is no Ollama app", async () => {
  let running = false;
  const started: string[] = [];
  const ok = await recoverModelServer({
    up: async () => running,
    appPath: null,
    cliPath: "/opt/homebrew/bin/ollama",
    start: async (program) => {
      started.push(program);
      running = true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(started, ["/opt/homebrew/bin/ollama"]);
});
`,
    },
  },
  DISK_LOW: {
    code: "DISK_LOW",
    title: "Measure free disk space the way downloads see it (bavail, not bfree)",
    target: {
      path: "brain/free-space.ts",
      before: `export type DiskStats = { bfree: number; bavail: number; bsize: number };

/** Free bytes this app can write. */
export function freeBytes(stats: DiskStats): number {
  return stats.bfree * stats.bsize;
}

export function hasRoomFor(stats: DiskStats, neededBytes: number): boolean {
  return freeBytes(stats) >= neededBytes;
}
`,
      after: `export type DiskStats = { bfree: number; bavail: number; bsize: number };

/** Free bytes this app can write. Blocks the system keeps for itself are not counted. */
export function freeBytes(stats: DiskStats): number {
  return stats.bavail * stats.bsize;
}

export function hasRoomFor(stats: DiskStats, neededBytes: number): boolean {
  return freeBytes(stats) >= neededBytes;
}
`,
    },
    test: {
      path: "brain/free-space.test.ts",
      content: `import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRoomFor } from "./free-space.ts";

// Reports: ENOSPC near the end of the model download although the space check passed.
test("blocks reserved for the system do not count as free", () => {
  const stats = { bfree: 12_000, bavail: 1_000, bsize: 1_000_000 };
  assert.equal(hasRoomFor(stats, 10.9e9), false);
});
`,
    },
  },
  PORT_IN_USE: {
    code: "PORT_IN_USE",
    title: "Pick a free port when another app took the saved one",
    target: {
      path: "workspace/choose-port.ts",
      before: `export async function choosePort(
  saved: number | undefined,
  isFree: (port: number) => Promise<boolean>,
  allocate: () => Promise<number>,
): Promise<number> {
  return saved ?? allocate();
}
`,
      after: `export async function choosePort(
  saved: number | undefined,
  isFree: (port: number) => Promise<boolean>,
  allocate: () => Promise<number>,
): Promise<number> {
  if (saved !== undefined && (await isFree(saved))) return saved;
  return allocate();
}
`,
    },
    test: {
      path: "workspace/choose-port.test.ts",
      content: `import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { choosePort } from "./choose-port.ts";

const listen = (port = 0) =>
  new Promise<import("node:net").Server>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
const isFree = async (port: number) => {
  try {
    (await listen(port)).close();
    return true;
  } catch {
    return false;
  }
};
const allocate = async () => {
  const server = await listen();
  const port = (server.address() as { port: number }).port;
  server.close();
  return port;
};

// Reports: EADDRINUSE on the API port after another app started first.
test("a saved port another app holds is replaced by a free one", async () => {
  const other = await listen();
  const taken = (other.address() as { port: number }).port;
  try {
    const port = await choosePort(taken, isFree, allocate);
    assert.notEqual(port, taken);
    assert.equal(await isFree(port), true);
  } finally {
    other.close();
  }
});
`,
    },
  },
  MODEL_CORRUPT: {
    code: "MODEL_CORRUPT",
    title: "Treat a model that is listed but cannot load as damaged",
    target: {
      path: "brain/model-check.ts",
      before: `export type ModelDeps = {
  tags: () => Promise<string[]>;
  load: (alias: string) => Promise<{ ok: boolean; error?: string }>;
};

export async function modelStatus(deps: ModelDeps, alias: string): Promise<"ready" | "missing" | "corrupt"> {
  return (await deps.tags()).includes(alias) ? "ready" : "missing";
}
`,
      after: `export type ModelDeps = {
  tags: () => Promise<string[]>;
  load: (alias: string) => Promise<{ ok: boolean; error?: string }>;
};

export async function modelStatus(deps: ModelDeps, alias: string): Promise<"ready" | "missing" | "corrupt"> {
  if (!(await deps.tags()).includes(alias)) return "missing";
  // Listed is not enough: a download cut short leaves a model that is listed but cannot load.
  return (await deps.load(alias)).ok ? "ready" : "corrupt";
}
`,
    },
    test: {
      path: "brain/model-check.test.ts",
      content: `import assert from "node:assert/strict";
import { test } from "node:test";
import { modelStatus } from "./model-check.ts";

// Reports: MODEL_CORRUPT "invalid file magic" while setup said the model was ready.
test("a listed model that cannot load is corrupt", async () => {
  const status = await modelStatus(
    { tags: async () => ["swift-1.5-27b"], load: async () => ({ ok: false, error: "invalid file magic" }) },
    "swift-1.5-27b",
  );
  assert.equal(status, "corrupt");
});
`,
    },
  },
};

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { STACK_ENV_TEMPLATE } from "./local-stack.js";
import { WindowsStackController } from "./windows-stack.js";

type Call = { command: string; args: string[]; env: Record<string, string>; input?: string };

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  Object.assign(child, {
    pid: 4242,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => {
      setImmediate(() => child.emit("exit", 0, null));
      return true;
    },
  });
  return child;
}

async function setup(options: { pgVersion?: boolean; e2b?: string } = {}) {
  const stackDir = await mkdtemp(path.join(os.tmpdir(), "burrow-win-"));
  const resourceDir = await mkdtemp(path.join(os.tmpdir(), "burrow-win-res-"));
  await writeFile(
    path.join(resourceDir, STACK_ENV_TEMPLATE),
    "POSTGRES_PASSWORD=\nPOSTGRES_APP_PASSWORD=\nBETTER_AUTH_SECRET=\nENCRYPTION_KEY=\nSCREEN_PROXY_SECRET=\n",
  );
  if (options.pgVersion) {
    await mkdir(path.join(stackDir, "pgdata"), { recursive: true });
    await writeFile(path.join(stackDir, "pgdata", "PG_VERSION"), "16\n");
  }
  const serverDir = path.join(stackDir, "runtime", "server-1", "rakazo-server");
  const calls: Call[] = [];
  const spawned: Call[] = [];
  const controller = new WindowsStackController({
    stackDir,
    resourceDir,
    localWebUrl: "http://127.0.0.1:45173",
    imageTag: "v1.0.0",
    serverBundle: { version: "1" },
    nodeBinary: "C:\\Your AI\\Your AI.exe",
    platform: "win32",
    env: { PATH: "C:\\Windows", SystemRoot: "C:\\Windows" },
    run: async (command, args, opts) => {
      calls.push({ command, args, env: opts.env as Record<string, string>, input: opts.input });
      const sql = args.at(-1) ?? "";
      return { code: 0, stdout: sql.startsWith("SELECT 1") ? " ?column? \n----------\n(0 rows)\n" : "", stderr: "" };
    },
    fetch: async () => new Response("ok"),
    exists: existsSync,
    probe: async () => "v1.0.0",
    randomHex: (bytes) => "ab".repeat(bytes),
    spawn: (command, args, opts) => {
      spawned.push({ command, args, env: opts.env });
      return fakeChild();
    },
    sleep: async () => {},
    databaseAnswers: async () => {},
    portFree: async () => true,
    allocatePort: (() => {
      let next = 50000;
      return async () => next++;
    })(),
    cloudComputerKey: async () => options.e2b,
    installServer: async () => ({
      dir: serverDir,
      manifest: { version: "1", entrypoints: { api: "api.js", worker: "worker.js", web: "web.js", migrate: "migrate.js" } },
    }),
  });
  return { controller, calls, spawned, stackDir, serverDir };
}

describe("Windows stack (no Docker, embedded Postgres)", () => {
  it("creates a password-only cluster once, then starts Postgres, migrations and the server", async () => {
    const { controller, calls, spawned, serverDir, stackDir } = await setup();
    await controller.start();
    expect(controller.state().phase).toBe("ready");

    const initdb = calls.find((c) => c.command.endsWith(path.join("bin", "initdb.exe")));
    expect(initdb?.args).toEqual(expect.arrayContaining(["-U", "rakazo", "-A", "scram-sha-256"]));
    const pgStart = calls.find((c) => c.command.endsWith("pg_ctl.exe") && c.args[0] === "start");
    expect(pgStart?.args.join(" ")).toContain("-c listen_addresses=127.0.0.1");

    const ensure = calls.find((c) => c.args[0] === "-e");
    expect(ensure?.env.GENTE_DATABASE).toBe("rakazo");
    expect(ensure?.env.GENTE_PG_URL).toMatch(/^postgres:\/\/rakazo:.*@127\.0\.0\.1:\d+\/postgres$/);
    const migrate = calls.find((c) => c.args[0]?.endsWith("migrate.js"));
    expect(migrate?.env.DATABASE_URL).toMatch(/^postgres:\/\/rakazo_app:/);
    expect(migrate?.env.ELECTRON_RUN_AS_NODE).toBe("1");

    const api = spawned.find((s) => s.args.some((a) => a.endsWith("api.js")));
    expect(api?.env.SANDBOX_PROVIDER).toBe("none");
    expect(api?.env.API_HOST).toBe("127.0.0.1");
    expect(api?.env.DATABASE_URL).toContain("@127.0.0.1:");
    expect(spawned.map((s) => path.basename(s.args.at(-1) ?? s.command))).toEqual(
      expect.arrayContaining(["api.js", "worker.js", "web.js"]),
    );
    expect(serverDir).toContain("rakazo-server");
    await mkdir(path.join(stackDir, "pgdata"), { recursive: true });
    await writeFile(path.join(stackDir, "pgdata", "postmaster.pid"), "1\n");
    await controller.stop();
    expect(calls.some((c) => c.command.endsWith("pg_ctl.exe") && c.args[0] === "stop")).toBe(true);
  });

  it("keeps an existing cluster: no initdb on later starts", async () => {
    const { controller, calls } = await setup({ pgVersion: true });
    await controller.start();
    expect(controller.state().phase).toBe("ready");
    expect(calls.some((c) => c.command.endsWith("initdb.exe"))).toBe(false);

  });

  it("gives bots an E2B cloud computer when the keychain has a key", async () => {
    const { controller, spawned } = await setup({ e2b: "e2b_test_key" });
    await controller.start();
    const api = spawned.find((s) => s.args.some((a) => a.endsWith("api.js")));
    expect(api?.env.SANDBOX_PROVIDER).toBe("e2b");
    expect(api?.env.E2B_API_KEY).toBe("e2b_test_key");
  });
});

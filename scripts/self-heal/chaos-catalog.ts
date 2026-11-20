// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The full failure catalog, injected for real and timed. Each service Gente runs has a stand-in
// that is a real process or a real server on a real port: the database, the API, the worker, the
// model server, Gente Cloud, the sign-in service and the relay. A fault is real (a killed process,
// a taken port, a stalled worker, a log line), the repair is the catalog's own ladder run by the
// real engine, and the clock runs from the fault to the moment the check says healthy again.
// Only one number is simulated: free disk space.
//
//   pnpm exec tsx scripts/self-heal/chaos-catalog.ts [--json out.json] [--md out.md]
// Exit code 1 when any failure is not detected, not repaired as expected, or slower than its budget.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { createServer as createHttp } from "node:http";
import type { Server, Socket } from "node:net";
import { connect, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { HealEnv, LogSignal } from "../../apps/desktop/src/main/self-heal/catalog.js";
import { CATALOG } from "../../apps/desktop/src/main/self-heal/catalog.js";
import type { FailureSpec, HealEvent } from "../../apps/desktop/src/main/self-heal/engine.js";
import { HealEngine } from "../../apps/desktop/src/main/self-heal/engine.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stand-in service as a real child process: a TCP server that answers, optionally beating. */
const SERVICE_JS = `
const net = require("node:net");
const fs = require("node:fs");
const [port, beatFile, dbPort] = process.argv.slice(1);
// Connections stay open, like a database's: the worker's connection lives until the process dies.
const server = net.createServer((s) => { s.on("error", () => {}); });
server.listen(Number(port), "127.0.0.1");
if (beatFile) {
  // The worker: beats while its database connection lives. Like the real bug, it never reconnects.
  let alive = false;
  const sock = net.connect(Number(dbPort), "127.0.0.1", () => { alive = true; });
  sock.on("error", () => { alive = false; });
  sock.on("close", () => { alive = false; });
  setInterval(() => { if (alive) fs.writeFileSync(beatFile, String(Date.now())); }, 200);
}
`;

function tcpUp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: "127.0.0.1" });
    s.setTimeout(500);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(false));
  });
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

class Proc {
  child: ChildProcess | null = null;
  constructor(
    public port: number,
    private readonly args: () => string[] = () => [],
  ) {}
  async start() {
    this.child = spawn(process.execPath, ["-e", SERVICE_JS, String(this.port), ...this.args()], {
      stdio: "ignore",
    });
    for (let i = 0; i < 40 && !(await tcpUp(this.port)); i++) await sleep(50);
  }
  kill() {
    this.child?.kill("SIGKILL");
    this.child = null;
  }
  async killed() {
    this.kill();
    for (let i = 0; i < 40 && (await tcpUp(this.port)); i++) await sleep(50);
  }
  async restart() {
    await this.killed();
    await this.start();
  }
}

type HttpStub = {
  server: HttpServer;
  port: number;
  close: () => Promise<void>;
  start: () => Promise<void>;
};
async function httpStub(
  handler: (url: string, res: import("node:http").ServerResponse) => void,
  port = 0,
): Promise<HttpStub> {
  const sockets = new Set<Socket>();
  let server = createHttp((req, res) => handler(req.url ?? "/", res));
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const bound = (server.address() as { port: number }).port;
  const stub: HttpStub = {
    server,
    port: bound,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(() => r(undefined)));
    },
    start: async () => {
      server = createHttp((req, res) => handler(req.url ?? "/", res));
      server.on("connection", (s) => {
        sockets.add(s);
        s.on("close", () => sockets.delete(s));
      });
      await new Promise<void>((r) => server.listen(bound, "127.0.0.1", r));
      stub.server = server;
    },
  };
  return stub;
}

export type ChaosRow = {
  id: string;
  fault: string;
  detected: boolean;
  outcome: HealEvent["outcome"] | "none";
  fixedBy?: string;
  expected: { outcome: HealEvent["outcome"]; fixedBy?: string };
  recoverMs: number | null;
  budgetMs: number;
  pass: boolean;
  simulated?: string;
};

export async function runCatalogChaos(): Promise<ChaosRow[]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "gente-chaos-catalog-"));
  const beatFile = path.join(tmp, "worker.beat");
  const logFile = path.join(tmp, "api.log");
  const cacheDir = path.join(tmp, "cache");
  const appDir = path.join(tmp, "rakazo-server");
  await writeFile(logFile, "");
  await mkdir(path.join(appDir, "worker"), { recursive: true });
  await writeFile(path.join(appDir, "worker", "index.js"), "");

  const db = new Proc(await freePort());
  const api = new Proc(await freePort());
  const relay = new Proc(await freePort());
  const worker = new Proc(await freePort(), () => [beatFile, String(db.port)]);
  await db.start();
  await Promise.all([api.start(), relay.start(), worker.start()]);

  let modelMode: "ok" | "corrupt" | "slow" = "ok";
  const ollama = await httpStub((url, res) => {
    if (url === "/api/show" && modelMode === "corrupt") {
      res.statusCode = 500;
      return res.end('{"error":"invalid file magic"}');
    }
    if (url === "/api/generate" && modelMode === "slow")
      return setTimeout(() => res.end("{}"), 1500);
    res.end("{}");
  });
  const cloudCalls: string[] = [];
  const cloud = await httpStub((url, res) => {
    if (url.startsWith("/notify/")) cloudCalls.push(url.slice(8));
    res.end("{}");
  });
  let token: "ok" | "expired" = "ok";
  const auth = await httpStub((url, res) => {
    if (url === "/refresh") token = "ok";
    res.statusCode = token === "ok" ? 200 : 401;
    res.end();
  });

  let computerLocal = false;
  let latency: number | null = null;
  let squatter: Server | null = null;
  let logOffset = 0;
  const SIMULATED_FREE_GB = { full: 1, afterClean: 40 };

  const env: HealEnv = {
    ollamaUp: () => tcpUp(ollama.port),
    modelState: async () => {
      const res = await fetch(`http://127.0.0.1:${ollama.port}/api/show`, { method: "POST" }).catch(
        () => null,
      );
      return !res ? "unknown" : res.ok ? "ready" : "corrupt";
    },
    localLatencyMs: () => latency,
    postgresUp: () => tcpUp(db.port),
    apiUp: async () => !squatter && (await tcpUp(api.port)),
    worker: async () => {
      if (!worker.child) return "down";
      const beat = Number(await readFile(beatFile, "utf8").catch(() => "0"));
      return Date.now() - beat > 1_500 ? "stalled" : "ok";
    },
    portHeldByOther: async () => squatter !== null,
    missingAppFiles: async () =>
      (await stat(path.join(appDir, "worker", "index.js")).catch(() => null))
        ? []
        : ["worker: worker/index.js"],
    freeDiskBytes: async () =>
      ((await stat(path.join(cacheDir, "blob")).catch(() => null))
        ? SIMULATED_FREE_GB.full
        : SIMULATED_FREE_GB.afterClean) * 1e9,
    logSignals: async () => {
      const text = await readFile(logFile, "utf8");
      const fresh = text.slice(logOffset);
      logOffset = text.length;
      const found = new Set<LogSignal>();
      if (/template .* not found/i.test(fresh)) found.add("computer-template-missing");
      if (/composio\b.*not configured/i.test(fresh)) found.add("apps-not-configured");
      if (/fal[^\n]*balance/i.test(fresh)) found.add("media-balance-empty");
      return found;
    },
    retryRequest: async () => {
      await sleep(300);
    },
    signIn: async () => {
      const res = await fetch(`http://127.0.0.1:${auth.port}/check`).catch(() => null);
      return res?.ok ? "ok" : "expired";
    },
    relayUp: () => tcpUp(relay.port),
    computerIsLocal: async () => computerLocal,
    retryOllama: async () => {},
    startOllama: async () => {
      if (!ollama.server.listening) await ollama.start();
    },
    restartService: async (name) => {
      if (name === "postgres") await db.restart();
      if (name === "worker") await worker.restart();
      if (name === "relay") await relay.restart();
      if (name === "api") {
        // Like the real API, a taken port means starting on a free one.
        if (squatter) {
          api.kill();
          api.port = await freePort();
          squatter.close();
          squatter = null;
        }
        await api.restart();
      }
    },
    resetStack: async () => {
      await db.restart();
      await Promise.all([api.restart(), worker.restart()]);
    },
    redownloadModel: async () => {
      await sleep(300);
      modelMode = "ok";
    },
    clearCaches: async () => {
      await rm(cacheDir, { recursive: true, force: true });
    },
    refreshSignIn: async () => {
      await fetch(`http://127.0.0.1:${auth.port}/refresh`);
    },
    useLocalComputer: async () => {
      computerLocal = true;
    },
    notifyCloud: async (id) => {
      await fetch(`http://127.0.0.1:${cloud.port}/notify/${id}`);
    },
  };

  type Scenario = {
    fault: string;
    inject: () => Promise<void>;
    expected: { outcome: HealEvent["outcome"]; fixedBy?: string };
    healthy: () => Promise<boolean>;
    reset?: () => Promise<void>;
    simulated?: string;
  };
  const scenarios: Record<string, Scenario> = {
    "worker-stalled": {
      fault: "the database drops; the worker stays alive but stops taking jobs",
      inject: async () => {
        await db.restart(); // the worker's connection dies and it never reconnects (the real bug)
      },
      expected: { outcome: "fixed", fixedBy: "restart-worker" },
      healthy: async () => (await env.worker()) === "ok",
    },
    "database-stopped": {
      fault: "a test stops Postgres (process killed)",
      inject: async () => db.kill(),
      expected: { outcome: "fixed", fixedBy: "restart-database" },
      healthy: () => env.postgresUp(),
      // The database restart drops the worker's connection: let the worker failure heal next.
      reset: async () => worker.restart(),
    },
    "api-down": {
      fault: "the API process dies",
      inject: async () => api.kill(),
      expected: { outcome: "fixed", fixedBy: "restart-api" },
      healthy: () => env.apiUp(),
    },
    "model-server-down": {
      fault: "Ollama stops (server closed)",
      inject: async () => ollama.close(),
      expected: { outcome: "fixed", fixedBy: "start-model-server" },
      healthy: () => env.ollamaUp(),
    },
    "slow-replies": {
      fault: "the model is busy (another program uses it): first word after 25 s",
      inject: async () => {
        latency = 25_000;
      },
      // Nothing to send anywhere: Gente waits and shows its calm line.
      expected: { outcome: "needs-person" },
      healthy: async () => true,
      reset: async () => {
        latency = null;
      },
    },
    "bundle-module-missing": {
      fault: "a module is missing from the app bundle (file deleted)",
      inject: async () => rm(path.join(appDir, "worker", "index.js")),
      expected: { outcome: "reported", fixedBy: "report-for-update" },
      healthy: async () => cloudCalls.includes("bundle-module-missing"),
      reset: async () => writeFile(path.join(appDir, "worker", "index.js"), ""),
    },
    "computer-template-missing": {
      fault: "the online computer's template is missing (server log line)",
      inject: async () => appendFile(logFile, "E2B: sandbox template gente-desktop not found\n"),
      expected: { outcome: "fixed", fixedBy: "use-this-computer" },
      healthy: () => env.computerIsLocal(),
      reset: async () => {
        computerLocal = false;
      },
    },
    "sign-in-expired": {
      fault: "the sign-in token expires (401)",
      inject: async () => {
        token = "expired";
      },
      expected: { outcome: "fixed", fixedBy: "refresh-sign-in" },
      healthy: async () => (await env.signIn()) === "ok",
    },
    "relay-down": {
      fault: "the connected-apps relay process dies",
      inject: async () => relay.kill(),
      expected: { outcome: "fixed", fixedBy: "restart-relay" },
      healthy: async () => (await env.relayUp()) === true,
    },
    "disk-full": {
      fault: "the disk is almost full (1 GB free)",
      inject: async () => {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(path.join(cacheDir, "blob"), "x");
      },
      expected: { outcome: "fixed", fixedBy: "clear-cache" },
      healthy: async () => ((await env.freeDiskBytes()) ?? 0) > 3e9,
      simulated: "the free-space number (the cache folder is really deleted)",
    },
    "port-in-use": {
      fault: "another program takes the API's port",
      inject: async () => {
        api.kill();
        for (let i = 0; i < 40 && (await tcpUp(api.port)); i++) await sleep(50);
        const taken = createServer((s) => s.destroy());
        await new Promise<void>((resolve, reject) => {
          taken.once("error", reject);
          taken.listen(api.port, "127.0.0.1", resolve);
        });
        squatter = taken;
      },
      expected: { outcome: "fixed", fixedBy: "restart-on-free-port" },
      healthy: async () => !squatter && (await env.apiUp()),
    },
    "model-corrupt": {
      fault: "the model file is damaged (Ollama: invalid file magic)",
      inject: async () => {
        modelMode = "corrupt";
      },
      expected: { outcome: "fixed", fixedBy: "redownload-model" },
      healthy: async () => (await env.modelState()) === "ready",
    },
    "apps-not-configured": {
      fault: "connected apps are not configured (server log line), relay down",
      inject: async () => {
        relay.kill();
        await appendFile(logFile, "composio: connected apps not configured\n");
      },
      expected: { outcome: "fixed", fixedBy: "reconnect-apps" },
      healthy: async () => (await env.relayUp()) === true,
    },
    "media-balance-empty": {
      fault: "the image service's balance is empty (server log line)",
      inject: async () => appendFile(logFile, "fal: balance exhausted, answering with stubs\n"),
      expected: { outcome: "reported", fixedBy: "tell-gente-cloud" },
      healthy: async () => cloudCalls.includes("media-balance-empty"),
    },
  };

  const rows: ChaosRow[] = [];
  try {
    for (const spec of CATALOG) {
      const scenario = scenarios[spec.id];
      if (!scenario) {
        rows.push({
          id: spec.id,
          fault: "(no chaos scenario)",
          detected: false,
          outcome: "none",
          expected: { outcome: "fixed", fixedBy: "" },
          recoverMs: null,
          budgetMs: spec.budgetMs,
          pass: false,
        });
        continue;
      }
      // One engine per failure, so earlier failures do not change this one's timing.
      const events: HealEvent[] = [];
      const engine = new HealEngine<HealEnv>({
        env,
        specs: [spec as FailureSpec<HealEnv>],
        onEvent: (e) => events.push(e),
        pollMs: 100,
      });
      await engine.tick(); // healthy baseline
      if (events.length > 0) throw new Error(`${spec.id} fired before its fault`);
      await scenario.inject();
      const started = Date.now();
      const deadline = started + spec.budgetMs * 4 + 5_000;
      let recoverMs: number | null = null;
      while (Date.now() < deadline) {
        await engine.tick();
        if (events.length > 0 && (await scenario.healthy())) {
          recoverMs = Date.now() - started;
          break;
        }
        await sleep(100);
      }
      const event = events[0];
      const pass =
        event !== undefined &&
        recoverMs !== null &&
        event.outcome === scenario.expected.outcome &&
        (scenario.expected.fixedBy === undefined || event.fixedBy === scenario.expected.fixedBy) &&
        recoverMs <= spec.budgetMs;
      rows.push({
        id: spec.id,
        fault: scenario.fault,
        detected: events.length > 0,
        outcome: event?.outcome ?? "none",
        ...(event?.fixedBy ? { fixedBy: event.fixedBy } : {}),
        expected: scenario.expected,
        recoverMs,
        budgetMs: spec.budgetMs,
        pass,
        ...(scenario.simulated ? { simulated: scenario.simulated } : {}),
      });
      if (process.env.CHAOS_VERBOSE) console.error(JSON.stringify(rows.at(-1)));
      await scenario.reset?.();
      // Let every service settle back to healthy before the next fault.
      for (let i = 0; i < 40 && (await env.worker()) !== "ok"; i++) await sleep(100);
    }
  } finally {
    for (const p of [db, api, relay, worker]) p.kill();
    (squatter as Server | null)?.close();
    await Promise.all([ollama.close().catch(() => {}), cloud.close(), auth.close()]);
    await rm(tmp, { recursive: true, force: true });
  }
  return rows;
}

export function markdownTable(rows: ChaosRow[]): string {
  const line = (r: ChaosRow) =>
    `| ${r.id} | ${r.fault} | ${r.fixedBy ?? "none"} (${r.outcome}) | ${r.recoverMs === null ? "did not recover" : `${(r.recoverMs / 1000).toFixed(1)} s`} / ${(r.budgetMs / 1000).toFixed(0)} s | ${r.pass ? "pass" : "FAIL"}${r.simulated ? ` (simulated: ${r.simulated})` : ""} |`;
  return [
    "| Failure | Fault injected | Repair (outcome) | Recover / budget | Test |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(line),
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const rows = await runCatalogChaos();
  console.log(markdownTable(rows));
  const json = process.argv.indexOf("--json");
  if (json > 0 && process.argv[json + 1])
    await writeFile(process.argv[json + 1] as string, JSON.stringify(rows, null, 2));
  const md = process.argv.indexOf("--md");
  if (md > 0 && process.argv[md + 1])
    await writeFile(process.argv[md + 1] as string, `${markdownTable(rows)}\n`);
  process.exitCode = rows.every((r) => r.pass) ? 0 : 1;
}

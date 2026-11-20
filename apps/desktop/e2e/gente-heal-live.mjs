// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Self-healing inside the real installed app, on a CI runner (never on a person's computer):
// starts Gente, waits for its workspace, then breaks real parts of it (kills the database, the
// API and the worker processes) and times how long until each works again. It also reads the
// app's own "Gente fixed itself" timeline to say who repaired it: the self-heal engine, or the
// process supervisor's own restart.
//   node e2e/gente-heal-live.mjs <path-to-app-executable> <out-dir>
// Run after gente-smoke.mjs in the same job (the workspace is already set up).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { createOllamaStub } from "../scripts/ollama-stub.mjs";

const [exe, outArg] = process.argv.slice(2);
const out = path.resolve(outArg ?? "gente-heal-live");
mkdirSync(out, { recursive: true });
const userData =
  process.platform === "win32"
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Gente")
    : path.join(os.homedir(), "Library", "Application Support", "Gente");
const stack = path.join(userData, "stack");
const lines = [];
const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.join(" ")}`;
  lines.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stub = createOllamaStub();
await new Promise((resolve, reject) => {
  stub.server.once("error", reject);
  stub.server.listen(11434, "127.0.0.1", resolve);
});

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const ports = () =>
  readJson(path.join(stack, ".native-ports")) ?? readJson(path.join(stack, ".windows-ports")) ?? {};
// Supervised services write run/<name>.pid; Postgres (started with pg_ctl) keeps its own
// postmaster.pid in its data folder, first line.
const pid = (name) => {
  if (name === "postgres") return Number(readFileSync(path.join(stack, "pgdata", "postmaster.pid"), "utf8").split(/\r?\n/)[0].trim());
  return Number(readFileSync(path.join(stack, "run", `${name}.pid`), "utf8").trim());
};
const tcpUp = (port) =>
  new Promise((resolve) => {
    const s = connect({ port, host: "127.0.0.1" });
    s.setTimeout(800);
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
const apiHealthy = async () => {
  const port = ports().api;
  if (!port) return false;
  return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
};
const alive = (p) => {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
};
const timeline = () =>
  (() => {
    try {
      return readFileSync(path.join(userData, "self-heal-timeline.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  })();

const results = [];
let failure = null;
const app = await electron.launch({
  executablePath: exe,
  timeout: 180_000,
  env: { ...process.env, GENTE_E2E_MEMORY_GB: "32" },
});
try {
  const setup = await app.firstWindow();
  // Wait for the workspace (the app window opens on its server's address).
  const deadline = Date.now() + 15 * 60_000;
  let clicked = false;
  while (!app.windows().some((w) => w.url().startsWith("http")) && Date.now() < deadline) {
    if (!clicked && (await setup.isEnabled("#continue", { timeout: 1000 }).catch(() => false))) {
      await setup.click("#continue", { timeout: 5000 }).then(
        () => (clicked = true),
        () => {},
      );
    }
    await sleep(2000);
  }
  for (let i = 0; i < 60 && !(await apiHealthy()); i++) await sleep(2000);
  if (!(await apiHealthy())) throw new Error("workspace never became healthy");
  log("workspace healthy; ports", JSON.stringify(ports()));
  await sleep(5000); // let the self-heal engine settle its first checks

  const faults = [
    {
      id: "database-stopped",
      kill: () => pid("postgres"),
      healthy: async () => tcpUp(ports().postgres) && (await apiHealthy()),
    },
    { id: "api-down", kill: () => pid("api"), healthy: apiHealthy },
    {
      id: "worker-stalled",
      kill: () => pid("worker"),
      healthy: async () => {
        try {
          return alive(pid("worker"));
        } catch {
          return false;
        }
      },
    },
  ];
  for (const fault of faults) {
    const before = timeline().length;
    let victim;
    try {
      victim = fault.kill();
      process.kill(victim, "SIGKILL");
    } catch (error) {
      results.push({ id: fault.id, error: `could not kill: ${error.message}` });
      continue;
    }
    const started = Date.now();
    log(`fault ${fault.id}: killed pid ${victim}`);
    await sleep(300);
    let recoverMs = null;
    while (Date.now() - started < 90_000) {
      if (await fault.healthy()) {
        recoverMs = Date.now() - started;
        break;
      }
      await sleep(250);
    }
    await sleep(3000); // the engine may log its event just after the service is back
    const events = timeline()
      .slice(before)
      .filter((e) => e.failureId === fault.id || e.at >= new Date(started).toISOString());
    const engine = events.find((e) => e.failureId === fault.id);
    const row = {
      id: fault.id,
      recoverMs,
      repairedBy: engine
        ? `self-heal engine: ${engine.fixedBy ?? engine.outcome} (${engine.ms} ms)`
        : recoverMs !== null
          ? "process supervisor's own restart"
          : "not repaired",
      timeline: events,
    };
    results.push(row);
    log(
      `fault ${fault.id}: ${recoverMs === null ? "NOT RECOVERED" : `recovered in ${(recoverMs / 1000).toFixed(1)} s`} by ${row.repairedBy}`,
    );
    for (let i = 0; i < 40 && !(await apiHealthy()); i++) await sleep(1000);
  }
  if (results.some((r) => r.recoverMs === null || r.recoverMs === undefined))
    failure = new Error("a fault did not recover");
} catch (error) {
  failure = error;
  log("FAIL:", error?.stack ?? String(error));
} finally {
  await Promise.race([app.close().catch(() => {}), sleep(30_000)]);
  writeFileSync(path.join(out, "heal-live.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(path.join(out, "heal-live.log"), `${lines.join("\n")}\n`);
  const table = [
    "| Failure (real app) | Recovered in | Repaired by |",
    "| --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.recoverMs == null ? "not recovered" : `${(r.recoverMs / 1000).toFixed(1)} s`} | ${r.error ?? r.repairedBy} |`,
    ),
  ].join("\n");
  writeFileSync(path.join(out, "heal-live.md"), `${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Self-healing in the real app (${process.platform})\n${table}\n`,
      { flag: "a" },
    );
}
process.exit(failure ? 1 : 0);

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The chaos subset: five real faults injected against Gente's real health checks and self-healing
// monitor. Real servers, real ports, real files. Only the disk-full fault fakes the number the
// disk reports, because filling a CI runner's disk would break the runner itself.
//
//   pnpm exec tsx scripts/self-heal/chaos.ts [--json out.json]

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:net";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { findMissingAppFiles } from "../../apps/desktop/src/main/support/app-files.js";
import { ErrorCatcher } from "../../apps/desktop/src/main/support/diagnostics.js";
import type { FailureCode, HealthProbe } from "../../apps/desktop/src/main/support/health.js";
import { runHealthChecks } from "../../apps/desktop/src/main/support/health.js";
import { SupportMonitor } from "../../apps/desktop/src/main/support/monitor.js";
import {
  freeDiskBytes,
  ollamaModelError,
  ollamaTags,
  ollamaUp,
  portHeldByOther,
} from "../../apps/desktop/src/main/support/probes.js";

const ALIAS = "swift-1.5-27b";

/** A stand-in Ollama that can be healthy, stopped or serving a damaged model. */
async function stubOllama(mode: () => "ok" | "corrupt", port = 0) {
  const server = createHttpServer((req, res) => {
    if (req.url === "/api/version") return res.end('{"version":"0.12.0"}');
    if (req.url === "/api/tags")
      return res.end(JSON.stringify({ models: [{ name: `${ALIAS}:latest` }] }));
    if (req.url === "/api/show") {
      if (mode() === "corrupt") {
        res.statusCode = 500;
        return res.end('{"error":"invalid file magic"}');
      }
      return res.end("{}");
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const bound = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${bound}`, port: bound };
}

const close = (server: Server | HttpServer) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

export type ChaosResult = {
  fault: string;
  expected: FailureCode;
  detected: boolean;
  healed: boolean | "needs-person-or-update";
  detail: string;
};

export async function runChaos(): Promise<ChaosResult[]> {
  const results: ChaosResult[] = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), "gente-chaos-"));
  let mode: "ok" | "corrupt" = "ok";
  const ollama = await stubOllama(() => mode);
  let ollamaServer: HttpServer = ollama.server;
  let fakeFree: number | null = null;
  let apiPort: number | null = null;
  const serverDir = path.join(tmp, "rakazo-server");
  const logLines: string[] = [];

  const probe: HealthProbe = {
    version: "chaos",
    platform: process.platform,
    ollamaUp: () => ollamaUp(ollama.url),
    ollamaTags: () => ollamaTags(ollama.url),
    modelError: (alias) => ollamaModelError(ollama.url, alias),
    modelAlias: async () => ALIAS,
    freeDiskBytes: async () => fakeFree ?? (await freeDiskBytes(tmp)),
    portConflict: async () =>
      apiPort === null ? null : { port: apiPort, heldByOther: await portHeldByOther(apiPort) },
    missingAppFiles: async () =>
      findMissingAppFiles({
        serverDir,
        manifest: { entrypoints: { api: "api/index.js", worker: "worker/index.js" } },
        exists: existsSync,
        serviceLogLines: logLines,
      }),
    workspacePhase: () => "ready",
    telegramLinked: async () => null,
  };
  const healed: string[] = [];
  const monitor = () =>
    new SupportMonitor({
      probe,
      fixes: {
        // The same restart a person's tap runs: bring the model server back, free the port.
        restartServices: async () => {
          healed.push("restart-services");
          if (!ollamaServer.listening)
            ollamaServer = (await stubOllama(() => mode, ollama.port)).server;
          apiPort = null;
          return true;
        },
        redownloadModel: async () => {
          healed.push("redownload-model");
          mode = "ok";
          return true;
        },
        clearCache: async () => true,
        relinkTelegram: async () => true,
        log: () => {},
      },
      catcher: new ErrorCatcher(path.join(tmp, "logs"), {}),
      shareChoice: async () => "never",
      buildBundle: async () => ({}) as never,
      send: async () => false,
      onChange: () => {},
    });
  const codes = async () =>
    (await monitor().check()).checks.filter((c) => c.status === "fail").map((c) => c.code);

  try {
    await mkdir(path.join(serverDir, "api"), { recursive: true });
    await writeFile(path.join(serverDir, "api", "index.js"), "");
    await mkdir(path.join(serverDir, "worker"), { recursive: true });
    await writeFile(path.join(serverDir, "worker", "index.js"), "");
    const baseline = await codes();
    if (baseline.length > 0) throw new Error(`healthy baseline failed: ${baseline.join(", ")}`);

    // 1. A module missing from the bundle: the worker entry is deleted and the API log says so.
    await rm(path.join(serverDir, "worker", "index.js"));
    logLines.push("Error: Cannot find module 'pg-native'");
    let found = await runHealthOnly(probe);
    results.push({
      fault: "missing module in the bundle",
      expected: "BUNDLE_MODULE_MISSING",
      detected: found.includes("BUNDLE_MODULE_MISSING"),
      healed: "needs-person-or-update",
      detail: "no local fix can restore app files; the report goes to the pipeline",
    });
    await writeFile(path.join(serverDir, "worker", "index.js"), "");
    logLines.length = 0;

    // 2. Ollama down: the stand-in server is stopped for real.
    await close(ollamaServer);
    found = await runHealthOnly(probe);
    const afterRestart = await codes();
    results.push({
      fault: "Ollama down",
      expected: "OLLAMA_DOWN",
      detected: found.includes("OLLAMA_DOWN"),
      healed: !afterRestart.includes("OLLAMA_DOWN") && healed.includes("restart-services"),
      detail: `after self-heal: ${afterRestart.join(", ") || "healthy"}`,
    });

    // 3. Disk full (reported free space set to 0.4 GB).
    fakeFree = 0.4e9;
    found = await runHealthOnly(probe);
    results.push({
      fault: "disk full",
      expected: "DISK_LOW",
      detected: found.includes("DISK_LOW"),
      healed: "needs-person-or-update",
      detail: "Gente asks the person to free space and offers Clear the cache",
    });
    fakeFree = null;

    // 4. Port in use: another program really listens on the API port and is not Gente.
    const sockets = new Set<import("node:net").Socket>();
    const squatter = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.end("not gente\n");
    });
    await new Promise<void>((resolve) => squatter.listen(0, "127.0.0.1", resolve));
    apiPort = (squatter.address() as { port: number }).port;
    found = await runHealthOnly(probe);
    const afterPort = await codes();
    results.push({
      fault: "port in use",
      expected: "PORT_IN_USE",
      detected: found.includes("PORT_IN_USE"),
      healed: !afterPort.includes("PORT_IN_USE"),
      detail: "self-heal restarts services, which choose a free port",
    });
    for (const socket of sockets) socket.destroy();
    await close(squatter);

    // 5. A corrupt model download: Ollama lists the model but cannot read it.
    mode = "corrupt";
    found = await runHealthOnly(probe);
    results.push({
      fault: "corrupt model download",
      expected: "MODEL_CORRUPT",
      detected: found.includes("MODEL_CORRUPT"),
      healed: "needs-person-or-update",
      detail: "Support offers Download the model again (8.9 GB, so never automatic)",
    });
    mode = "ok";
  } finally {
    await close(ollamaServer).catch(() => undefined);
    await rm(tmp, { recursive: true, force: true });
  }
  return results;
}

async function runHealthOnly(probe: HealthProbe) {
  return (await runHealthChecks(probe)).checks
    .filter((c) => c.status === "fail")
    .map((c) => c.code);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const results = await runChaos();
  for (const r of results)
    console.log(
      `${r.detected && r.healed !== false ? "PASS" : "FAIL"}  ${r.fault}: ${r.expected} detected=${r.detected} healed=${r.healed}  (${r.detail})`,
    );
  const out = process.argv.indexOf("--json");
  if (out > 0 && process.argv[out + 1])
    await writeFile(process.argv[out + 1] as string, JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.detected && r.healed !== false) ? 0 : 1);
}

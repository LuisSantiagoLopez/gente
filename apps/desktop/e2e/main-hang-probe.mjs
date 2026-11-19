// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// CI diagnostic: starts the installed app with the Node inspector, waits, then pauses the main
// process and prints where its JavaScript is (or says it is idle), plus whether Electron is ready.
//   node e2e/main-hang-probe.mjs <app-executable> [wait-seconds]
import { spawn } from "node:child_process";

const [exe, waitArg] = process.argv.slice(2);
const port = 9339;
const child = spawn(exe, [`--inspect=${port}`, "--enable-logging=stderr", "--v=0"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", GENTE_E2E_MEMORY_GB: "32" },
});
const output = [];
for (const s of [child.stdout, child.stderr]) s.on("data", (d) => output.push(String(d)));
await new Promise((r) => setTimeout(r, Number(waitArg ?? 45) * 1000));
console.log("--- app output\n" + output.join("").slice(-6000));
try {
  const [target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    else events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Runtime.enable");
  const evalIn = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: true })).result;
  console.log("--- evaluate (answers only if the main thread is free)");
  const quick = await Promise.race([
    evalIn(
      "JSON.stringify({ uptime: process.uptime(), ready: globalThis.require ? 'cjs' : 'esm', handles: process._getActiveHandles?.().length, requests: process._getActiveRequests?.().length, mem: process.memoryUsage().rss })",
    ),
    new Promise((r) => setTimeout(() => r("main thread busy: no answer in 5 s"), 5000)),
  ]);
  console.log(JSON.stringify(quick));
  await send("Debugger.enable");
  await send("Debugger.pause");
  await new Promise((r) => setTimeout(r, 3000));
  const paused = events.find((e) => e.method === "Debugger.paused");
  if (!paused) console.log("--- no pause: the JavaScript thread is stuck in native code");
  else {
    const scripts = new Map(events.filter((e) => e.method === "Debugger.scriptParsed").map((e) => [e.params.scriptId, e.params.url]));
    console.log("--- main process stack");
    for (const f of paused.params.callFrames.slice(0, 25))
      console.log(`${f.functionName || "(anonymous)"} ${scripts.get(f.location.scriptId) ?? f.location.scriptId}:${f.location.lineNumber + 1}`);
  }
  ws.close();
} catch (error) {
  console.log("probe failed:", error?.message ?? error);
}
child.kill();
process.exit(0);

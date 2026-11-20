// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// CI diagnostic: starts the installed app with the Node inspector, waits, then pauses the main
// process and prints where its JavaScript is (or says it is idle), plus whether Electron is ready.
//   node e2e/main-hang-probe.mjs <app-executable> [wait-seconds]
import { execFileSync, spawn } from "node:child_process";

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
// A startup error shows as a modal box: capture the screen, and check the main bundle's packages.
const shots = process.env.PROBE_OUT ?? (await import("node:os")).tmpdir();
try {
  if (process.platform === "darwin") execFileSync("/usr/sbin/screencapture", ["-x", `${shots}/probe-screen.png`]);
  if (process.platform === "win32")
    execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; [System.Drawing.Graphics]::FromImage($i).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${shots}\\probe-screen.png')`]);
  if (process.platform === "win32")
    console.log(execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName UIAutomationClient; $r=[System.Windows.Automation.AutomationElement]::RootElement; $c=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${child.pid}); $w=$r.FindAll([System.Windows.Automation.TreeScope]::Children,$c); foreach($x in $w){ $x.Current.Name; foreach($t in $x.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)){ $t.Current.Name } }`], { encoding: "utf8", timeout: 30_000 }));
} catch (error) {
  console.log("screen capture failed:", error.message);
}
// Native stack of the main thread (macOS `sample`), for a thread stuck outside JavaScript.
if (process.platform === "darwin") {
  try {
    const text = execFileSync("/usr/bin/sample", [String(child.pid), "2"], { encoding: "utf8", timeout: 60_000 });
    const start = text.indexOf("Call graph:");
    console.log("--- native stacks (sample)\n" + text.slice(start, start + 12000));
  } catch (error) {
    console.log("sample failed:", error.message);
  }
}
if (process.platform === "win32") {
  try {
    console.log(execFileSync("tasklist", ["/v", "/fi", `PID eq ${child.pid}`], { encoding: "utf8" }));
  } catch {}
}
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
    new Promise((r, j) => {
      setTimeout(() => j(new Error(`${method}: no answer in 8 s (main thread stuck outside JavaScript)`)), 8000);
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

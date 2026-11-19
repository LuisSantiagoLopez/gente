// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Drives the installed Gente.app through first-run onboarding and screenshots each step.
//   node e2e/burrow-onboarding.mjs <out-dir>
// Env: BURROW_APP (default /Applications/Gente.app), BURROW_OLLAMA_URL (a stub or real Ollama),
//      BURROW_SKIP_CLICK=1 to only open the window.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const out = path.resolve(process.argv[2] ?? "/tmp/burrow-e2e");
await mkdir(out, { recursive: true });
const appPath = process.env.BURROW_APP ?? "/Applications/Gente.app";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const app = await electron.launch({
  executablePath: path.join(appPath, "Contents/MacOS/Gente"),
  env: { ...process.env },
  timeout: 120_000,
});
log("packaged:", await app.evaluate(({ app }) => app.isPackaged), "name:", await app.evaluate(({ app }) => app.getName()));
const setup = await app.firstWindow();
await setup.waitForSelector("#continue");
await setup.screenshot({ path: path.join(out, "01-setup.png") });
log("heading:", await setup.textContent("h1"));
log("model:", await setup.textContent("#brain-size"));

await setup.click("#brain-models summary");
const options = await setup.$$eval(".model .model-name", (els) => els.map((e) => e.textContent));
log("picker options:", JSON.stringify(options));
await setup.screenshot({ path: path.join(out, "02-picker.png") });
if (process.env.BURROW_PICK) {
  await setup.click(`input[name="swift-model"][value="${process.env.BURROW_PICK}"]`);
  log("picked:", await setup.textContent("#brain-size"));
}
if (process.env.BURROW_SKIP_CLICK === "1") {
  await app.close();
  process.exit(0);
}

await setup.click("#continue");
log("clicked Get started");
let last = "";
const deadline = Date.now() + Number(process.env.BURROW_TIMEOUT_MS ?? 30 * 60_000);
let shot = 3;
while (Date.now() < deadline) {
  const windows = app.windows();
  const main = windows.find((w) => !w.url().startsWith("file:"));
  if (main) {
    log("app window:", main.url());
    await main.waitForLoadState("domcontentloaded").catch(() => {});
    await main.waitForTimeout(5000);
    await main.screenshot({ path: path.join(out, "20-app.png") });
    break;
  }
  if (setup.isClosed()) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  const state = await setup
    .evaluate(() => ({
      brain: document.querySelector("#step-brain")?.getAttribute("data-state"),
      brainText: document.querySelector("#brain-status")?.textContent?.trim(),
      brainDetail: document.querySelector("#brain-detail")?.textContent?.trim(),
      stack: document.querySelector("#step-stack")?.getAttribute("data-state"),
      stackText: document.querySelector("#stack-phase")?.textContent?.trim(),
      stackDetail: document.querySelector("#stack-detail")?.textContent?.trim(),
      status: document.querySelector("#status")?.textContent?.trim(),
      out: document.querySelector("#stack-output")?.textContent?.split("\n").slice(-3).join(" | "),
    }))
    .catch(() => null);
  const line = JSON.stringify(state);
  if (state && line !== last) {
    last = line;
    log(line);
    if (shot < 19) await setup.screenshot({ path: path.join(out, `${String(shot++).padStart(2, "0")}-progress.png`) }).catch(() => {});
    if (state.brain === "error" || state.stack === "error") {
      await setup.click("#stack-details").catch(() => {});
      await setup.screenshot({ path: path.join(out, "19-error.png") });
      log("full output:", await setup.textContent("#stack-output").catch(() => ""));
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (process.env.BURROW_KEEP_OPEN !== "1") await app.close();
log("done");

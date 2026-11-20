// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Installed-app smoke test on real Windows and macOS runners:
//   memory check (shown, then passed) → Get started → workspace (embedded Postgres) →
//   sign up → starter bot → "hey" → reply.
// The model server is scripts/ollama-stub.mjs on 127.0.0.1:11434 (no GPU on the runner).
// Writes screenshots, smoke.log and timings.json (seconds per step) to <out-dir>.
//   node e2e/gente-smoke.mjs <path-to-app-executable> <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { createOllamaStub } from "../scripts/ollama-stub.mjs";

const [exe, outArg] = process.argv.slice(2);
const out = path.resolve(outArg ?? "gente-e2e");
mkdirSync(out, { recursive: true });
const lines = [];
const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.join(" ")}`;
  lines.push(line);
  console.log(line);
};
// The stand-in model server lives in this process: a step's background process does not
// survive on Windows runners, and Gente would then install the real Ollama and model.
const stub = createOllamaStub();
await new Promise((resolve, reject) => {
  stub.server.once("error", reject);
  stub.server.listen(11434, "127.0.0.1", resolve);
});
const t0 = Date.now();
const timings = {};
const mark = (step) => {
  timings[step] = Math.round((Date.now() - t0) / 1000);
  log(`step ${step} at ${timings[step]}s`);
};
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
const shot = (page, name) =>
  within(page.screenshot({ path: path.join(out, name), timeout: 15_000 }), 20_000).catch((e) =>
    log("screenshot failed", name, e.message),
  );
const close = (app) => within(app.close().catch(() => {}), 30_000);
const launch = (memoryGB) =>
  electron.launch({
    executablePath: exe,
    timeout: 180_000,
    env: { ...process.env, GENTE_E2E_MEMORY_GB: String(memoryGB) },
  });

let failure = null;
try {
  // 1. The friendly memory check, on a pretend 8 GB computer: nothing downloads.
  {
    const app = await launch(8);
    try {
      const setup = await app.firstWindow();
      mark("first-window");
      await setup.waitForSelector("#continue", { timeout: 120_000 });
      await setup.click("#continue");
      await setup.waitForFunction(() => /16 GB/.test(document.querySelector("#brain-status")?.textContent ?? ""), null, {
        timeout: 60_000,
      });
      await shot(setup, "00-memory-check.png");
      log("memory check:", await setup.textContent("#brain-status"));
    } finally {
      await close(app);
    }
  }

  // 2. The real run.
  const app = await launch(32);
  try {
    log("packaged:", await app.evaluate(({ app }) => app.isPackaged), "name:", await app.evaluate(({ app }) => app.getName()));
    const setup = await app.firstWindow();
    await setup.waitForSelector("#continue", { timeout: 120_000 });
    mark("setup-shown");
    await shot(setup, "01-setup.png");
    // Gente may start the workspace on its own; otherwise press Get started once it is enabled.
    let clicked = false;
    let page;
    const deadline = Date.now() + 25 * 60_000;
    let last = "";
    let shotProgress = false;
    while (!page && Date.now() < deadline) {
      page = app.windows().find((w) => w.url().startsWith("http"));
      if (page) break;
      if (!clicked && (await setup.isEnabled("#continue", { timeout: 1000 }).catch(() => false))) {
        await setup.click("#continue", { timeout: 5000 }).then(
          () => {
            clicked = true;
            log("clicked Get started");
          },
          () => {},
        );
      }
      const state = await setup
        .evaluate(() => [
          document.querySelector("#brain-status")?.textContent,
          document.querySelector("#stack-phase")?.textContent,
          document.querySelector("#stack-output")?.textContent?.slice(-400),
        ])
        .catch(() => null);
      const line = JSON.stringify(state);
      if (state && line !== last) {
        last = line;
        log(line);
        if (!shotProgress && state[1]) {
          shotProgress = true;
          await shot(setup, "02-setup-progress.png");
        }
      }
      // Zero-error rule: the setup screen never shows a raw error, so any error tone fails the test.
      const tone = await setup.evaluate(() => document.querySelector('[data-tone="error"]')?.textContent ?? null).catch(() => null);
      if (tone) {
        await setup.click("#stack-details").catch(() => {});
        await shot(setup, "02-error.png");
        throw new Error(`setup error shown: ${tone}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!page) throw new Error("app window never opened");
    mark("workspace-ready");
    log("app window:", page.url());
    await page.waitForSelector("input[name=email]", { timeout: 120_000 });
    await shot(page, "03-signup.png");
    await page.fill("input[name=name]", "Gente Test");
    await page.fill("input[name=email]", "smoke@gente.local");
    await page.fill("input[name=password]", "gente-smoke-pass-123");
    await page.click("button[type=submit]");
    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 180_000 });
    mark("signed-up");
    await shot(page, "04-chat.png");
    const box = page.locator('textarea, [contenteditable="true"]').last();
    await box.click();
    await page.keyboard.type("hey");
    await page.keyboard.press("Enter");
    const sent = Date.now();
    await page.getByText("You said: hey").last().waitFor({ timeout: 180_000 });
    mark("first-reply");
    timings["reply-seconds"] = Math.round((Date.now() - sent) / 1000);
    await shot(page, "05-reply.png");
    log("PASS: chat reply arrived");
  } finally {
    for (const w of app.windows()) await shot(w, `99-last-${app.windows().indexOf(w)}.png`);
    await close(app);
  }
} catch (error) {
  failure = error;
  log("FAIL:", error?.stack ?? String(error));
} finally {
  writeFileSync(path.join(out, "timings.json"), `${JSON.stringify(timings, null, 2)}\n`);
  writeFileSync(path.join(out, "smoke.log"), `${lines.join("\n")}\n`);
  writeFileSync(path.join(out, "stub-calls.json"), JSON.stringify(stub.calls.map((c) => c.path), null, 1));
}
process.exit(failure ? 1 : 0);

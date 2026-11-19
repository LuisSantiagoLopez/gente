// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
//
// Real-Windows smoke test for the installed app (run in CI on windows-2025):
// onboarding → workspace (embedded Postgres) → sign up → starter bot → chat reply.
// The model server is scripts/ollama-stub.mjs on 127.0.0.1:11434 (no GPU on the runner).
//   node e2e/burrow-windows-smoke.mjs <path-to-Burrow.exe> <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const [exe, outArg] = process.argv.slice(2);
const out = path.resolve(outArg ?? "burrow-windows-e2e");
mkdirSync(out, { recursive: true });
const lines = [];
const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.join(" ")}`;
  lines.push(line);
  console.log(line);
};
const app = await electron.launch({ executablePath: exe, timeout: 180_000 });
try {
  log("packaged:", await app.evaluate(({ app }) => app.isPackaged), "name:", await app.evaluate(({ app }) => app.getName()));
  const setup = await app.firstWindow();
  await setup.waitForSelector("#continue", { timeout: 120_000 });
  await setup.screenshot({ path: path.join(out, "01-setup.png") });
  await setup.click("#continue");
  log("clicked Get started");
  let page;
  const deadline = Date.now() + 25 * 60_000;
  let last = "";
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith("http"));
    if (page) break;
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
    }
    if (state?.[1]?.includes("did not start") || state?.[1]?.includes("failed")) {
      await setup.click("#stack-details").catch(() => {});
      await setup.screenshot({ path: path.join(out, "02-error.png") });
      throw new Error(`workspace failed: ${line}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!page) throw new Error("app window never opened");
  log("app window:", page.url());
  await page.waitForSelector("input[name=email]", { timeout: 120_000 });
  await page.screenshot({ path: path.join(out, "03-signup.png") });
  await page.fill("input[name=name]", "Windows Test");
  await page.fill("input[name=email]", "windows@burrow.local");
  await page.fill("input[name=password]", "burrow-windows-pass-123");
  await page.click("button[type=submit]");
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 180_000 });
  await page.screenshot({ path: path.join(out, "04-chat.png") });
  const box = page.locator('textarea, [contenteditable="true"]').last();
  await box.click();
  await page.keyboard.type("hey");
  await page.keyboard.press("Enter");
  await page.getByText("You said: hey").last().waitFor({ timeout: 180_000 });
  await page.screenshot({ path: path.join(out, "05-reply.png") });
  log("PASS: chat reply arrived");
} finally {
  writeFileSync(path.join(out, "smoke.log"), `${lines.join("\n")}\n`);
  await app.close().catch(() => {});
}

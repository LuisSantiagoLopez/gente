// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A first run that only does what a person can see: it reads the screen and clicks what is
// written there. No element IDs, no test hooks, no knowledge of how Gente works inside.
// It fails if it ever has to guess, or if any screen shows technical words.
//   node e2e/gente-first-run-visible.mjs <path-to-Gente-binary> <out-dir>
// Run it on a clean machine (CI), never next to a person's own Gente data.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const [exe, outArg] = process.argv.slice(2);
const out = path.resolve(outArg ?? "gente-first-run");
mkdirSync(out, { recursive: true });
const steps = [];
const t0 = Date.now();
const step = (what) => {
  const line = `${((Date.now() - t0) / 1000).toFixed(1)}s  ${what}`;
  steps.push(line);
  console.log(line);
};
const TECHNICAL = /\bHTTP\s*\d{3}|WebSocket|\bE(CONN\w*|NOENT|ADDRINUSE|TIMEDOUT)\b|stack ?trace|Traceback/i;
let shot = 0;
async function look(page, name) {
  await page.screenshot({ path: path.join(out, `${String(shot++).padStart(2, "0")}-${name}.png`) }).catch(() => {});
  const text = await page.innerText("body").catch(() => "");
  if (TECHNICAL.test(text)) throw new Error(`Technical words on screen at "${name}": ${text.match(TECHNICAL)?.[0]}`);
  return text;
}

// Beside a person's own Gente, a smoke run adds `--use-mock-keychain` so it never asks for, or
// touches, their saved keys.
const extra = (process.env.GENTE_E2E_ARGS ?? "").split(" ").filter(Boolean);
// Gente keeps a hidden, pre-warmed window around; the one a person sees is the visible one.
async function visibleWebWindow(app) {
  for (const w of app.windows()) {
    if (!w.url().startsWith("http")) continue;
    if ((await w.evaluate(() => document.visibilityState).catch(() => "hidden")) === "visible") return w;
  }
  return null;
}
const app = await electron.launch({ executablePath: exe, args: ["--lang=en-US", ...extra], timeout: 180_000 });
try {
  const first = await app.firstWindow();
  await first.waitForLoadState("domcontentloaded");
  await first.waitForTimeout(3000);
  const text0 = await look(first, "welcome");
  // A first run starts by itself. Pressing anything here counts as a click a beginner had to make.
  let clicks = 0;
  if (/Getting Gente ready|Almost ready|Starting the workspace|Downloading the workspace/.test(text0)) {
    step("Setup started by itself, no click");
  } else {
    clicks++;
    step('Setup waited for a click; pressing "Get started" (counts as a click)');
    await first.getByRole("button", { name: "Get started" }).click();
  }

  // Wait, reading the screen, until Gente opens its main window.
  let page = null;
  let last = "";
  while (!page && Date.now() - t0 < 30 * 60_000) {
    page = (await visibleWebWindow(app));
    if (page) break;
    const text = await look(first, "setup").catch(() => "");
    const status = text.split("\n").filter((l) => /…|ready|Downloading|Starting|Try again/.test(l)).join(" | ");
    if (status && status !== last) {
      last = status;
      step(`Setup says: ${status.slice(0, 160)}`);
    }
    if (/Try again/.test(text) && !/Get started/.test(text)) {
      clicks++;
      step('Setup asked to "Try again"; pressing it once (counts as a click)');
      await first.getByRole("button", { name: "Try again" }).click().catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!page) throw new Error("Gente's main window never opened");
  step("Main window opened");

  await page.getByRole("button", { name: /Create account/i }).waitFor({ timeout: 120_000 });
  await look(page, "sign-up");
  await page.getByLabel(/^Name/i).fill("First Run");
  await page.getByLabel(/^Email/i).fill("first.run@gente.local");
  await page.getByLabel(/^Password/i).fill("first-run-password-123");
  step('Filled the sign-up form; pressing "Create account"');
  await page.getByRole("button", { name: /Create account/i }).click();

  // The chat box shows once the first bot is ready. Page handles can go stale while the window
  // navigates after sign-up, so look again in every open window on each try.
  const hasBox = (w) =>
    w.evaluate(() => document.querySelector("textarea[placeholder^=Message]") !== null).catch(() => false);
  let found = null;
  for (let i = 0; i < 300 && !found; i++) {
    for (const w of app.windows()) if (w.url().startsWith("http") && (await hasBox(w))) found = w;
    if (!found) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!found) throw new Error("The chat box never appeared");
  page = found;
  const box = page.locator("textarea[placeholder^=Message]").first();
  await look(page, "chat");
  step('Chat is open; typing "hey"');
  await box.click();
  await page.keyboard.type("hey");
  const sent = Date.now();
  await page.keyboard.press("Enter");
  await page.getByText(/^(?!hey$).{3,}/).last().waitFor({ timeout: 300_000 });
  // The reply is the newest text after "hey".
  for (let i = 0; i < 600; i++) {
    const text = await page.innerText("main").catch(() => "");
    const after = text.slice(text.lastIndexOf("hey") + 3).replace(/Reading…|Working…/g, "").trim();
    if (after.length > 2) {
      step(`Reply arrived after ${((Date.now() - sent) / 1000).toFixed(1)}s: ${after.slice(0, 80)}`);
      break;
    }
    await page.waitForTimeout(100);
  }
  await look(page, "reply");
  step(`PASS: from open to first reply using only what was on screen; clicks besides sign-up: ${clicks}`);
} finally {
  writeFileSync(path.join(out, "steps.txt"), `${steps.join("\n")}\n`);
  await app.close().catch(() => {});
}

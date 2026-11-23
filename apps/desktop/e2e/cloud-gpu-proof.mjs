// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Live proof for Cloud GPU on a packaged build, with a throwaway data folder and the plain-process
// stack (GENTE_STACK=native). Signs up, optionally turns Cloud GPU on, sends one message, waits for
// the run to end, and writes screenshots and timings.json. Uses the real local model and, with
// --cloud, the real Modal GPU. Not part of CI.
//   node e2e/cloud-gpu-proof.mjs <app-executable> <out-dir> <data-dir> [--cloud] [--ask]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const [exe, outArg, dataDir, ...flags] = process.argv.slice(2);
const cloud = flags.includes("--cloud");
const ask = flags.includes("--ask");
const out = path.resolve(outArg);
mkdirSync(out, { recursive: true });
// Bots' computers on E2B through the developer's own key (Keychain), as in a dev build.
mkdirSync(dataDir, { recursive: true });
writeFileSync(path.join(dataDir, "dev-vendor-keys"), "");
const t0 = Date.now();
const timings = {};
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
const mark = (k) => {
  timings[k] = Number(((Date.now() - t0) / 1000).toFixed(2));
  log("mark", k, timings[k]);
};
const shot = (page, name) =>
  page
    .screenshot({ path: path.join(out, name), timeout: 15_000 })
    .catch((e) => log("shot", name, e.message));

/** Sets the host choice in this test's own Postgres (found through its API process). */
function recordHostChoice(dir) {
  const pids = execFileSync("pgrep", ["-f", "rakazo-server/apps/api/dist/index.js"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  for (const pid of pids) {
    const env = execFileSync("ps", ["eww", "-p", pid], { encoding: "utf8" });
    if (!env.includes(`DATA_DIR=${dir}/stack/data`)) continue;
    const url = (/DATABASE_MIGRATION_URL=(\S+)/.exec(env) ?? /DATABASE_URL=(\S+)/.exec(env))?.[1];
    if (!url) continue;
    execFileSync("/opt/homebrew/opt/postgresql@17/bin/psql", [
      url,
      "-c",
      `INSERT INTO deployment_settings (id, "computerHost", "updatedAt") VALUES ('default', 'docker', now())
       ON CONFLICT (id) DO UPDATE SET "computerHost" = 'docker'`,
    ]);
    return;
  }
  throw new Error("test API process not found");
}

const app = await electron.launch({
  executablePath: exe,
  // A test build is signed anew each time; the real Keychain would ask the owner to allow it.
  args: ["--use-mock-keychain"],
  timeout: 180_000,
  env: {
    ...process.env,
    GENTE_STACK: "native",
    RAKAZO_PERFORMANCE_USER_DATA: dataDir,
    GENTE_E2E_MEMORY_GB: "32",
  },
});
let failure = null;
try {
  const setup = await app.firstWindow({ timeout: 240_000 });
  let page;
  const deadline = Date.now() + 20 * 60_000;
  let clicked = false;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith("http"));
    if (page) break;
    if (!clicked && (await setup.isEnabled("#continue", { timeout: 1000 }).catch(() => false))) {
      await setup.click("#continue", { timeout: 5000 }).then(
        () => (clicked = true),
        () => {},
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!page) throw new Error("app window never opened");
  mark("workspace-ready");
  const withSelector = async (selector, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const w of app.windows().filter((x) => !x.isClosed() && x.url().startsWith("http")))
        if (await w.isVisible(selector).catch(() => false)) return w;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`no window showed ${selector}`);
  };
  const box = 'textarea, [contenteditable="true"]';
  page = await withSelector(`input[name=email], ${box}`, 180_000);
  if (await page.isVisible("input[name=email]").catch(() => false)) {
    await page.fill("input[name=name]", "Cloud Test");
    await page.fill("input[name=email]", "cloud@gente.local");
    await page.fill("input[name=password]", "gente-cloud-pass-123");
    await page.click("button[type=submit]");
  }
  page = await withSelector(box, 180_000);
  await page.setViewportSize?.({ width: 1280, height: 860 }).catch(() => {});
  mark("signed-in");
  // --frames: the app's own page, every 0.7 s, for the proof GIF (never the rest of the screen).
  let frameNo = 0;
  let frameBusy = false;
  const framesDir = path.join(out, "frames");
  if (flags.includes("--frames")) mkdirSync(framesDir, { recursive: true });
  const frameTimer = flags.includes("--frames")
    ? setInterval(() => {
        if (frameBusy || page.isClosed()) return;
        frameBusy = true;
        frameNo += 1;
        const name = path.join(framesDir, `f${String(frameNo).padStart(5, "0")}.png`);
        page
          .screenshot({ path: name, timeout: 5000 })
          .catch(() => {})
          .finally(() => (frameBusy = false));
      }, 700)
    : null;
  // A new workspace asks where bots run. This Mac has no Docker, and "this Mac" would let test
  // bots touch the owner's files, so the throwaway database records "docker" and bots use E2B.
  const hostPrompt = page.getByText("Where should bots run?");
  if (
    await hostPrompt.waitFor({ timeout: 30_000 }).then(
      () => true,
      () => false,
    )
  ) {
    recordHostChoice(dataDir);
    log("host choice recorded");
    await page.reload();
    page = await withSelector(box, 60_000);
    await hostPrompt.waitFor({ state: "hidden", timeout: 30_000 });
  }
  if (cloud) {
    const sw = page.getByTestId("cloud-gpu-switch");
    await sw.waitFor({ timeout: 30_000 });
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await page.getByTestId("cloud-gpu-status").waitFor({ timeout: 10_000 });
    mark("cloud-on");
  }
  await shot(page, "01-ready.png");
  const message = ask
    ? "I want to cook dinner tonight. Before you suggest anything, ask me which cuisine I want, with three options to pick from."
    : (process.env.PROOF_MESSAGE ?? "make a simple to-do web app");
  if (process.env.PROOF_WRITE_LIMITS)
    writeFileSync(
      path.join(dataDir, "stack", "cloud-gpu-limits.json"),
      process.env.PROOF_WRITE_LIMITS,
    );
  const repliesBefore = await page.getByTestId("reply-text").count();
  const activityBefore = await page.getByTestId("activity-preview").count();
  const input = page.locator(box).last();
  await input.click();
  await page.keyboard.type(message, { delay: 15 });
  await page.keyboard.press("Enter");
  const sent = Date.now();
  mark("sent");
  // Status line while the GPU starts.
  const statusTexts = new Set();
  let firstWord = null;
  const stopButton = page.getByRole("button", { name: /^stop$/i });
  const runEnd = Date.now() + 25 * 60_000;
  let sawRunning = false;
  while (Date.now() < runEnd) {
    const status = await page
      .getByTestId("cloud-gpu-status")
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (status) statusTexts.add(status.split(" · Cloud GPU is on")[0].replace(/\d+\.\d s/, "N s"));
    if (timings.first_activity_s === undefined) {
      const seen = await page
        .getByTestId("activity-preview")
        .nth(activityBefore)
        .textContent({ timeout: 300 })
        .catch(() => "");
      if (seen && seen.trim().length > 0) timings.first_activity_s = (Date.now() - sent) / 1000;
    }
    if (firstWord === null) {
      const said = await page
        .getByTestId("reply-text")
        .nth(repliesBefore)
        .textContent({ timeout: 300 })
        .catch(() => "");
      if (said && said.trim().length > 0) {
        firstWord = (Date.now() - sent) / 1000;
        timings.first_reply_text_s = firstWord;
      }
    }
    if (
      ask &&
      (await page
        .getByRole("button", { name: /italian|mexican|japanese|indian|thai|chinese|french/i })
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      mark("ask-card-shown");
      await shot(page, "02-ask-card.png");
      await page
        .getByRole("button", { name: /italian|mexican|japanese|indian|thai|chinese|french/i })
        .first()
        .click();
      mark("ask-answered");
      await new Promise((r) => setTimeout(r, 3000));
      flags.push("--answered");
    }
    const running = await stopButton.isVisible().catch(() => false);
    if (running) sawRunning = true;
    if (sawRunning && !running && Date.now() - sent > 5000) {
      if (!ask || flags.includes("--answered")) break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  timings.run_total_s = Number(((Date.now() - sent) / 1000).toFixed(1));
  timings.status_lines = [...statusTexts];
  const body = await page
    .locator("main")
    .textContent()
    .then((text) => text ?? "")
    .catch(() => "");
  timings.context_error = /context budget/i.test(body);
  writeFileSync(path.join(out, "page-text.txt"), body);
  await shot(page, "03-done.png");
  mark("done");
  if (cloud) {
    // Session end: the GPU is let go when the switch goes off (or 90 s after the answer).
    await page.getByTestId("cloud-gpu-switch").click();
    mark("cloud-off");
    await new Promise((r) => setTimeout(r, 3000));
    timings.status_after_off = await page
      .getByTestId("cloud-gpu-status")
      .textContent({ timeout: 500 })
      .catch(() => "(gone)");
    await shot(page, "04-off.png");
  }
  if (frameTimer) {
    await new Promise((r) => setTimeout(r, 2000));
    clearInterval(frameTimer);
  }
} catch (error) {
  failure = error;
  log("FAIL", error?.stack ?? String(error));
  for (const w of app.windows()) await shot(w, `99-fail-${app.windows().indexOf(w)}.png`);
} finally {
  writeFileSync(path.join(out, "timings.json"), `${JSON.stringify(timings, null, 2)}\n`);
  if (!flags.includes("--keep-open")) await app.close().catch(() => {});
}
process.exit(failure ? 1 : 0);

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Drives one long chat on a packaged build like a person would, for the use-case proofs
// (software, website, video). Throwaway data folder, plain-process stack, optional Cloud GPU.
// It signs up, then waits for messages: each file dropped in <out>/inbox/ (001.txt, 002.txt, ...)
// is typed into the chat and sent. After every turn it writes turn-NNN.json (timings and reply),
// a screenshot, and the whole chat as transcript.txt. Special inbox lines:
//   !click <button text>   click a button (an ask card option)
//   !shot <name>           screenshot only
//   !quit                  close the app
// Not part of CI.
//   node e2e/usecase-driver.mjs <app-executable> <out-dir> <data-dir> [--cloud]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const [exe, outArg, dataDir, ...flags] = process.argv.slice(2);
const cloud = flags.includes("--cloud");
const out = path.resolve(outArg);
const inbox = path.join(out, "inbox");
mkdirSync(inbox, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (state, extra = {}) =>
  writeFileSync(
    path.join(out, "status.json"),
    JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2),
  );

const app = await electron.launch({
  executablePath: exe,
  // A new ad-hoc signature asks the Keychain for the safe-storage key; that prompt cannot show
  // while the screen is locked (overnight runs), so the test uses Chromium's mock keychain.
  args: ["--use-mock-keychain"],
  timeout: 180_000,
  env: {
    ...process.env,
    GENTE_STACK: "native",
    RAKAZO_PERFORMANCE_USER_DATA: dataDir,
    GENTE_E2E_MEMORY_GB: "32",
    GENTE_DEV_VENDOR_KEYS: "1",
    RAKAZO_DISABLE_AUTO_UPDATE: "1",
  },
});
const shot = (page, name) =>
  page
    .screenshot({ path: path.join(out, name), timeout: 15_000 })
    .catch((e) => log("shot", name, e.message));
const box = 'textarea, [contenteditable="true"]';

async function withSelector(selector, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const w of app.windows().filter((x) => !x.isClosed() && x.url().startsWith("http")))
      if (await w.isVisible(selector).catch(() => false)) return w;
    await sleep(1000);
  }
  throw new Error(`no window showed ${selector}`);
}

async function openWorkspace() {
  const setup = await app.firstWindow({ timeout: 240_000 });
  let page;
  let clicked = false;
  const deadline = Date.now() + 20 * 60_000;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith("http"));
    if (page) break;
    if (!clicked && (await setup.isEnabled("#continue", { timeout: 1000 }).catch(() => false)))
      await setup.click("#continue", { timeout: 5000 }).then(
        () => (clicked = true),
        () => {},
      );
    await sleep(2000);
  }
  if (!page) throw new Error("app window never opened");
  page = await withSelector(`input[name=email], ${box}`, 180_000);
  if (await page.isVisible("input[name=email]").catch(() => false)) {
    await page.fill("input[name=name]", "Use Case Test");
    await page.fill("input[name=email]", "usecase@gente.local");
    await page.fill("input[name=password]", "gente-usecase-pass-123");
    await page.click("button[type=submit]");
  }
  page = await withSelector(box, 180_000);
  await page.setViewportSize?.({ width: 1280, height: 900 }).catch(() => {});
  const useMac = page.getByRole("button", { name: "Use this Mac" });
  // A new workspace asks where bots run; the test keeps them off this Mac (cloud computers).
  if (
    await useMac.waitFor({ timeout: 20_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await page
      .getByRole("button", { name: "Docker" })
      .click()
      .catch(() => page.keyboard.press("Escape"));
    await useMac.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    await sleep(1000);
  }
  if (cloud) {
    const sw = page.getByTestId("cloud-gpu-switch");
    await sw.waitFor({ timeout: 30_000 });
    if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
    await page.getByTestId("cloud-gpu-status").waitFor({ timeout: 10_000 });
  }
  return page;
}

async function saveTranscript(page) {
  const text = await page
    .locator("main")
    .innerText()
    .catch(() => "");
  writeFileSync(path.join(out, "transcript.txt"), text);
  return text;
}

async function sendTurn(page, n, message) {
  const replies = page.getByTestId("reply-text");
  const before = await replies.count();
  const input = page.locator(box).last();
  await input.click();
  await input.fill(message).catch(async () => page.keyboard.type(message, { delay: 5 }));
  await page.keyboard.press("Enter");
  const sent = Date.now();
  status("running", { turn: n });
  const stop = page.getByRole("button", { name: /^stop$/i });
  const timing = { turn: n, message, sentAt: new Date(sent).toISOString() };
  const statusLines = new Set();
  let sawRunning = false;
  let idleSince = null;
  const end = sent + 40 * 60_000;
  while (Date.now() < end) {
    const s = await page
      .getByTestId("cloud-gpu-status")
      .textContent({ timeout: 300 })
      .catch(() => null);
    if (s) statusLines.add(s.replace(/\d+(\.\d+)? ?s\b/g, "N s"));
    if (timing.first_word_s === undefined) {
      const said = await replies
        .nth(before)
        .textContent({ timeout: 300 })
        .catch(() => "");
      if (said?.trim()) timing.first_word_s = (Date.now() - sent) / 1000;
    }
    if (timing.first_activity_s === undefined) {
      const act = await page
        .getByTestId("activity-preview")
        .last()
        .textContent({ timeout: 300 })
        .catch(() => "");
      if (act?.trim()) timing.first_activity_s = (Date.now() - sent) / 1000;
    }
    // An approval card: the test user reads it (screenshot) and allows that one action.
    const allow = page.getByRole("button", { name: "Allow once" }).first();
    if (await allow.isVisible().catch(() => false)) {
      const asked = await page.locator("main").innerText().catch(() => "");
      timing.approvals = [...(timing.approvals ?? []), asked.split("Allow once")[0].slice(-300)];
      await shot(page, `turn-${n}-approval-${timing.approvals.length}.png`);
      await allow.click().catch(() => {});
    }
    const running = await stop.isVisible().catch(() => false);
    if (running) {
      sawRunning = true;
      idleSince = null;
    } else if (sawRunning || Date.now() - sent > 15_000) {
      idleSince ??= Date.now();
      // An ask card or a hand-off can pause the run; settle for 4 s before calling the turn done.
      if (Date.now() - idleSince > 4000) break;
    }
    if (Date.now() - (timing._lastShot ?? sent) > 60_000) {
      timing._lastShot = Date.now();
      await saveTranscript(page);
      await shot(page, `turn-${n}-live.png`);
    }
    await sleep(500);
  }
  delete timing._lastShot;
  timing.total_s = Number(((Date.now() - sent) / 1000).toFixed(1));
  timing.timed_out = Date.now() >= end;
  timing.status_lines = [...statusLines];
  const all = await replies.allTextContents().catch(() => []);
  timing.reply = all.slice(before).join("\n---\n");
  timing.reply_chars = timing.reply.length;
  const whole = await saveTranscript(page);
  writeFileSync(path.join(out, `transcript-${n}.txt`), whole);
  await shot(page, `turn-${n}.png`);
  writeFileSync(path.join(out, `turn-${n}.json`), `${JSON.stringify(timing, null, 2)}\n`);
  log("turn", n, "done", timing.total_s, "s");
}

let failure = null;
try {
  status("starting");
  let page = await openWorkspace();
  await shot(page, "00-ready.png");
  status("idle", { turn: 0 });
  // RESUME=1 reopens an existing chat: messages already in the inbox were sent before.
  const done = new Set(process.env.RESUME === "1" ? readdirSync(inbox) : []);
  for (;;) {
    const next = readdirSync(inbox)
      .filter((f) => /^\d+\.txt$/.test(f) && !done.has(f))
      .sort()[0];
    if (!next) {
      await sleep(2000);
      continue;
    }
    done.add(next);
    const n = next.replace(".txt", "");
    const text = readFileSync(path.join(inbox, next), "utf8").trim();
    if (text === "!quit") break;
    // The app can swap its window (a workspace restart); always use the one showing the chat.
    page = await withSelector(box, 10 * 60_000);
    if (text.startsWith("!shot ")) await shot(page, `${text.slice(6).trim()}.png`);
    else if (text.startsWith("!click ")) {
      await page
        .getByRole("button", { name: text.slice(7).trim() })
        .first()
        .click()
        .catch((e) => log("click", e.message));
      await sendTurnWait(page, n);
    } else await sendTurn(page, n, text);
    status("idle", { turn: n });
  }
} catch (error) {
  failure = error;
  log("FAIL", error?.stack ?? String(error));
  status("failed", { error: String(error) });
  for (const w of app.windows()) await shot(w, `99-fail-${app.windows().indexOf(w)}.png`);
} finally {
  if (!existsSync(path.join(out, "keep-open"))) await app.close().catch(() => {});
}
status(failure ? "failed" : "closed");
process.exit(failure ? 1 : 0);

async function sendTurnWait(page, n) {
  // After clicking an ask option the run resumes; wait for it like a sent turn, without typing.
  const stop = page.getByRole("button", { name: /^stop$/i });
  const start = Date.now();
  let idle = null;
  while (Date.now() - start < 40 * 60_000) {
    if (await stop.isVisible().catch(() => false)) idle = null;
    else if (Date.now() - start > 10_000) {
      idle ??= Date.now();
      if (Date.now() - idle > 4000) break;
    }
    await sleep(500);
  }
  await saveTranscript(page);
  await shot(page, `turn-${n}.png`);
  writeFileSync(
    path.join(out, `turn-${n}.json`),
    `${JSON.stringify({ turn: n, click: true, total_s: (Date.now() - start) / 1000 }, null, 2)}\n`,
  );
}

#!/usr/bin/env node
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Uber in a Browserbase cloud browser, with the person in control:
//   1. Opens a Browserbase session and prints its live view link: the person signs in to Uber
//      there themselves (Gente never sees the password).
//   2. Enters pickup and destination.
//   3. Reads the price and STOPS. Confirming is the person's click (or an approval in Gente),
//      never this script's.
// Keys come from the macOS Keychain (account "gente"): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID.
// The session is always released, and no more than 3 run at once (the project's limit).
//   node apps/desktop/scripts/gente-uber-flow.mjs --pickup "..." --dropoff "..." [--out dir] [--wait-login-s 300]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const out = path.resolve(args.out ?? "gente-uber-run");
mkdirSync(out, { recursive: true });
const keychain = (service) =>
  process.env[service] ??
  execFileSync("/usr/bin/security", ["find-generic-password", "-a", "gente", "-s", service, "-w"], {
    encoding: "utf8",
  }).trim();
const apiKey = keychain("BROWSERBASE_API_KEY");
const projectId = keychain("BROWSERBASE_PROJECT_ID");
const bb = (p, init = {}) =>
  fetch(`https://api.browserbase.com/v1${p}`, {
    ...init,
    headers: { "content-type": "application/json", "X-BB-API-Key": apiKey, ...(init.headers ?? {}) },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Browserbase ${p} → ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const running = await bb(`/sessions?status=RUNNING`).catch(() => []);
if (Array.isArray(running) && running.length >= 3) throw new Error("3 Browserbase sessions already running; wait for one to finish.");

const session = await bb("/sessions", { method: "POST", body: JSON.stringify({ projectId, keepAlive: false }) });
log("session", session.id, session.status ?? "", session.region ?? "");
let frame = 0;
const shot = async (page, name) => {
  const file = path.join(out, `${String(frame++).padStart(3, "0")}-${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
};
try {
  const live = await bb(`/sessions/${session.id}/debug`);
  log("LIVE VIEW (sign in to Uber here yourself):", live.debuggerFullscreenUrl);
  writeFileSync(path.join(out, "live-view.txt"), `${live.debuggerFullscreenUrl}\n`);
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 430, height: 860 }).catch(() => {});
  await page.goto("https://m.uber.com/go/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);
  await shot(page, "uber-open");
  // Decline optional cookies when Uber asks.
  await page.getByRole("button", { name: /opt out/i }).first().click({ timeout: 3000 }).catch(() => {});
  log("page:", page.url(), "|", (await page.title()).slice(0, 80));

  // Wait for the person to sign in through the live view.
  const waitMs = Number(args["wait-login-s"] ?? 0) * 1000;
  // Signed in when Uber no longer offers "Login" (the button sits in the page's top bar).
  const signedIn = async () =>
    !/auth\.uber\.com|login/i.test(page.url()) &&
    (await page.getByRole("button", { name: /^log ?in$/i }).or(page.getByRole("link", { name: /^log ?in$/i })).count()) === 0;
  const until = Date.now() + waitMs;
  while (!(await signedIn()) && Date.now() < until) {
    await page.waitForTimeout(3000);
    if (frame < 40) await shot(page, "waiting-login");
  }
  if (!(await signedIn())) {
    log("STOP: not signed in. Open the live view link, sign in to Uber, then run again with --wait-login-s.");
  } else if (args.pickup && args.dropoff) {
    log("signed in; entering the trip");
    const fill = async (labels, value) => {
      for (const label of labels) {
        // Uber's fields are buttons that open a search box.
        const target = page.getByPlaceholder(label).or(page.getByText(label)).first();
        if (!(await target.count())) continue;
        await target.click();
        await page.waitForTimeout(1200);
        await page.keyboard.type(value, { delay: 40 });
        await page.waitForTimeout(3000);
        await shot(page, "suggestions");
        const option = page.getByRole("option").first();
        if (await option.count()) await option.click();
        else {
          await page.keyboard.press("ArrowDown").catch(() => {});
          await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(2000);
        return true;
      }
      return false;
    };
    log("pickup set:", await fill([/pickup location/i, /where from/i], args.pickup));
    await shot(page, "pickup");
    log("dropoff set:", await fill([/dropoff location/i, /where to/i, /destination/i], args.dropoff));
    // Uber returns focus to an empty pickup box after the dropoff: fill it there.
    const pickupBox = page.getByPlaceholder(/pickup location/i).first();
    if ((await pickupBox.count()) && (await pickupBox.inputValue().catch(() => "")) === "") {
      await pickupBox.click();
      await page.keyboard.type(args.pickup, { delay: 40 });
      await page.waitForTimeout(3000);
      await shot(page, "pickup-again");
      const option = page.getByRole("option").first();
      if (await option.count()) await option.click();
      else await page.locator("li, [data-testid*=suggestion]").filter({ hasText: /seattle/i }).first().click().catch(() => {});
      await page.waitForTimeout(3000);
    }
    // Ask for prices.
    await page.getByRole("button", { name: /see prices|search|done/i }).first().click({ timeout: 4000 }).catch(() => {});
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2000);
      await shot(page, "price");
    }
    const prices = (await page.innerText("body")).match(/(?:MX\$|US\$|\$|€|£)\s?\d[\d,.]*/g) ?? [];
    log("PRICES SHOWN:", [...new Set(prices)].slice(0, 6).join(" | ") || "(none found)");
    log("STOPPED before confirming. Approve in Gente (or click in the live view) to request the ride.");
  }
  await browser.close().catch(() => {});
} finally {
  await bb(`/sessions/${session.id}`, {
    method: "POST",
    body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
  }).catch((e) => log("release error", e.message));
  const after = await bb(`/sessions/${session.id}`).catch(() => ({}));
  log("released; session status:", after.status ?? "?");
}

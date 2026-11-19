// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
//
// After onboarding: relaunch the installed app (persistence), send a chat, then switch the
// Swift model from the setup screen (app menu → Change Burrow Server…) and chat again.
//   node e2e/burrow-restart-switch.mjs <out-dir> [model-tag-to-switch-to]
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const out = path.resolve(process.argv[2] ?? "/tmp/burrow-e2e");
const switchTo = process.argv[3];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const app = await electron.launch({
  executablePath: "/Applications/Burrow.app/Contents/MacOS/Burrow",
  env: { ...process.env },
  timeout: 120_000,
});

async function appWindow(timeoutMs = 20 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => p.url().startsWith("http"));
    if (w && !w.isClosed()) return w;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("no app window");
}

async function chat(page, text, expect) {
  const box = page.locator('textarea, [contenteditable="true"]').last();
  await box.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  const reply = page.getByText(expect).last();
  await reply.waitFor({ timeout: 10 * 60_000 });
  log("reply:", (await reply.textContent())?.slice(0, 160));
}

let page = await appWindow(120_000);
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(4000);
log("after relaunch:", page.url());
await page.screenshot({ path: path.join(out, "30-relaunch.png") });
const history = await page.innerText("body");
log("history kept:", history.includes("Hello Chief, are you running locally?"));
await chat(page, "Second message after restart", "You said: Second message after restart");
await page.screenshot({ path: path.join(out, "31-after-restart-chat.png") });

if (switchTo) {
  await app.evaluate(({ Menu }) => {
    const find = (items) => {
      for (const item of items) {
        if (/Burrow/.test(item.label ?? "") && /(Server|servidor)/i.test(item.label ?? "")) return item;
        const sub = item.submenu && find(item.submenu.items);
        if (sub) return sub;
      }
      return null;
    };
    find(Menu.getApplicationMenu().items).click();
  });
  const deadline = Date.now() + 60_000;
  let setup;
  while (!setup && Date.now() < deadline) {
    setup = app.windows().find((w) => w.url().startsWith("file:") && !w.isClosed());
    await new Promise((r) => setTimeout(r, 500));
  }
  await setup.waitForSelector("#continue");
  await setup.click("#brain-models summary").catch(() => {});
  await setup.click(`input[name="swift-model"][value="${switchTo}"]`);
  log("picked:", await setup.textContent("#brain-size"));
  await setup.screenshot({ path: path.join(out, "32-switch-picker.png") });
  await setup.click("#continue");
  log("clicked Get started");
  const until = Date.now() + 20 * 60_000;
  while (Date.now() < until) {
    if (setup.isClosed()) break;
    const s = await setup
      .evaluate(() => [document.querySelector("#brain-status")?.textContent, document.querySelector("#stack-phase")?.textContent])
      .catch(() => null);
    if (s) log(JSON.stringify(s));
    if (s?.[1]?.includes("did not start")) {
      await setup.screenshot({ path: path.join(out, "33-switch-error.png") });
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  page = await appWindow();
  await page.waitForTimeout(4000);
  await chat(page, "Which model now?", "You said: Which model now?");
  await page.screenshot({ path: path.join(out, "34-after-switch-chat.png") });
}
await app.close();
log("done");

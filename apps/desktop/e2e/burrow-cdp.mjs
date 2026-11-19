// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Talks to a running Gente started with --remote-debugging-port=9333.
//   node e2e/burrow-cdp.mjs shot <file>              screenshot the app window, print its text
//   node e2e/burrow-cdp.mjs fill <selector> <text>   fill a field
//   node e2e/burrow-cdp.mjs click <selector>         click (Playwright selector, e.g. "text=Sign up")
//   node e2e/burrow-cdp.mjs press <key>
//   node e2e/burrow-cdp.mjs wait <selector> [ms]
//   node e2e/burrow-cdp.mjs eval <js>
import { chromium } from "@playwright/test";

const [cmd, a, b] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => p.url().startsWith("http")) ?? pages[0];
if (!page) throw new Error("no window");
console.log("url:", page.url());
switch (cmd) {
  case "shot":
    await page.screenshot({ path: a ?? "/tmp/burrow-shot.png" });
    console.log((await page.innerText("body")).slice(0, 2500));
    break;
  case "fill":
    await page.fill(a, b);
    break;
  case "click":
    await page.click(a, { timeout: 15_000 });
    break;
  case "press":
    await page.keyboard.press(a);
    break;
  case "type":
    await page.keyboard.type(a, { delay: 10 });
    break;
  case "wait":
    await page.waitForSelector(a, { timeout: Number(b ?? 60_000) });
    console.log("found");
    break;
  case "eval":
    console.log(JSON.stringify(await page.evaluate(a), null, 1));
    break;
  default:
    console.log("pages:", pages.map((p) => p.url()));
}
await browser.close().catch(() => {});
process.exit(0);

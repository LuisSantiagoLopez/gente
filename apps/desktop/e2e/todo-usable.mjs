// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Checks that a to-do app the AI wrote actually works: opens its index.html in headless
// Chromium, types a to-do, presses Enter (or clicks the first button), then ticks its checkbox
// (or clicks the item). Prints JSON: added, checked, errors. Used by the Cloud GPU proof.
//   node e2e/todo-usable.mjs <folder-with-index.html> [screenshot.png]
import path from "node:path";
import { chromium } from "@playwright/test";

const [dir, shotPath] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome" }); // the Mac's own Chrome, fresh profile
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`file://${path.resolve(dir, "index.html")}`);
const item = "Buy milk 4821";
const input = page.locator("input[type=text], input:not([type]), textarea").first();
await input.fill(item);
await input.press("Enter");
if (!(await page.getByText(item).count())) await page.locator("button").first().click();
const added = (await page.getByText(item).count()) > 0;
let checked = false;
if (added) {
  const row = page.locator("li, .todo, [class*=item]").filter({ hasText: item }).first();
  const box = row.locator("input[type=checkbox]");
  const before = await row.evaluate((el) => el.className + el.outerHTML.length);
  const toggle = row.locator("[class*=check], [class*=toggle], [class*=circle]").first();
  if (await box.count()) await box.first().check();
  else if (await toggle.count()) await toggle.click();
  else await row.click();
  const after = await row.evaluate((el) => el.className + el.outerHTML.length);
  checked = (await box.count()) ? await box.first().isChecked() : before !== after;
}
if (shotPath) await page.screenshot({ path: shotPath });
console.log(JSON.stringify({ added, checked, errors }));
await browser.close();

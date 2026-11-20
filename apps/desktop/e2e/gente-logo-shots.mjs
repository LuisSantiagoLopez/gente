// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Logo check on a running Gente (started with --remote-debugging-port=9333): opens Connections,
// finds Gmail, Figma, Notion, Slack and Discord, and for each one at 1× and 2×, light and dark:
//   - the logo is a real logo that loaded (not the letter fallback),
//   - the logo's box lies fully inside its tile (nothing spills past the plate),
//   - a screenshot of the tile is saved to <out-dir>.
// It only looks; it changes nothing, and puts the window back as it was.
//   node e2e/gente-logo-shots.mjs <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const out = path.resolve(process.argv[2] ?? "gente-logo-shots");
mkdirSync(out, { recursive: true });
const APPS = ["Gmail", "Figma", "Notion", "Slack", "Discord"];

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
let page = null;
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (!p.url().startsWith("http")) continue;
  if ((await p.evaluate(() => document.visibilityState).catch(() => "hidden")) === "visible")
    page = p;
}
if (!page) throw new Error("no visible Gente window");
const cdp = await page.context().newCDPSession(page);
const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const startUrl = page.url();
const results = [];
let failures = 0;
try {
  console.log("opening Connections");
  await page.getByText("Connect apps", { exact: true }).first().click({ timeout: 10_000 });
  const search = page.getByPlaceholder("Search apps");
  await search.waitFor({ timeout: 20_000 });
  console.log("Connections open");
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    for (const scale of [1, 2]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        ...size,
        deviceScaleFactor: scale,
        mobile: false,
      });
      for (const app of APPS) {
        await search.fill(app);
        const row = page
          .locator("button, li, [role=listitem], div")
          .filter({ hasText: new RegExp(`^${app}`) })
          .filter({ has: page.locator("[data-logo-tile]") })
          .last();
        const tile = row.locator("[data-logo-tile]").first();
        await tile.waitFor({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const check = await tile
          .evaluate((el) => {
            const img = el.querySelector("img");
            const t = el.getBoundingClientRect();
            if (!img) return { letter: el.textContent, inside: false, loaded: false };
            const i = img.getBoundingClientRect();
            const inside =
              i.left >= t.left - 0.5 &&
              i.top >= t.top - 0.5 &&
              i.right <= t.right + 0.5 &&
              i.bottom <= t.bottom + 0.5;
            return {
              src: img.src.slice(0, 60),
              loaded: img.complete && img.naturalWidth > 0,
              inside,
              tile: [t.width, t.height],
              img: [i.width, i.height],
            };
          })
          .catch((error) => ({ error: String(error).slice(0, 120) }));
        const ok = Boolean(check.loaded && check.inside);
        if (!ok) failures++;
        const file = `${app.toLowerCase()}-${scheme}-${scale}x.png`;
        const box = await tile.boundingBox().catch(() => null);
        if (box)
          await page.screenshot({
            path: path.join(out, file),
            clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
          });
        results.push({ app, scheme, scale, ok, ...check, file });
        console.log(`${ok ? "ok  " : "FAIL"} ${app} ${scheme} ${scale}x ${JSON.stringify(check)}`);
      }
    }
  }
} finally {
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  if (page.url() !== startUrl)
    await page.evaluate((url) => history.replaceState(null, "", url), startUrl).catch(() => {});
  writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(
  failures ? `${failures} logo checks failed` : `all ${results.length} logo checks passed`,
);
process.exit(failures ? 1 : 0);

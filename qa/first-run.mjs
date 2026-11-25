// Drives the installed Your AI like a first-time user and screenshots every step.
// node first-run.mjs <exe> <out-dir> <real|stub>
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const [exe, outArg, mode] = process.argv.slice(2);
const out = path.resolve(outArg); mkdirSync(out, { recursive: true });
const lines = []; const log = (...a) => { const l = `${new Date().toISOString()} ${a.join(" ")}`; lines.push(l); console.log(l); };
let n = 0; const shot = async (p, name) => { n++; const f = path.join(out, `${String(n).padStart(2, "0")}-${name}.png`); await p.screenshot({ path: f }).catch((e) => log("shot failed", name, e.message)); log("shot", f); };
const save = () => writeFileSync(path.join(out, "run.log"), `${lines.join("\n")}\n`);
const deadlineMin = mode === "real" ? 35 : 30;
const app = await electron.launch({ executablePath: exe, timeout: 180_000 });
app.process().stdout?.on("data", (d) => lines.push(`[stdout] ${String(d).trim().slice(0, 500)}`));
app.process().stderr?.on("data", (d) => lines.push(`[stderr] ${String(d).trim().slice(0, 500)}`));
try {
  log("mode", mode, "packaged", await app.evaluate(({ app }) => app.isPackaged), "version", await app.evaluate(({ app }) => app.getVersion()));
  const first = await app.firstWindow();
  await first.waitForLoadState("domcontentloaded").catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  log("first window", first.url(), await first.title().catch(() => ""));
  await shot(first, "first-window");
  writeFileSync(path.join(out, "first-window.txt"), (await first.evaluate(() => document.body.innerText).catch(() => "")) ?? "");
  const cont = first.locator("#continue");
  if (await cont.count()) { await cont.click(); log("clicked #continue (Get started)"); }
  else log("no #continue button on the first window");
  let page; const deadline = Date.now() + deadlineMin * 60_000; let last = ""; let lastShot = 0;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith("http"));
    if (page) break;
    const state = await first.evaluate(() => [
      document.querySelector("#brain-status")?.textContent, document.querySelector("#stack-phase")?.textContent,
      document.querySelector("#stack-output")?.textContent?.slice(-300), document.body.innerText.slice(0, 600)]).catch(() => null);
    const line = JSON.stringify(state);
    if (state && line !== last) { last = line; log("setup:", line); }
    if (Date.now() - lastShot > 120_000) { lastShot = Date.now(); await shot(first, "setup-progress"); }
    if (state && /did not start|failed|isn't enough|not enough memory|error/i.test(`${state[0]} ${state[1]}`)) { await shot(first, "setup-problem"); }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!page) { await shot(first, "setup-timeout"); throw new Error(`app window never opened within ${deadlineMin} min`); }
  log("app window", page.url());
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  await shot(page, "app-window");
  writeFileSync(path.join(out, "app-window.txt"), (await page.evaluate(() => document.body.innerText).catch(() => "")) ?? "");
  await page.waitForSelector("input[name=email]", { timeout: 120_000 });
  await shot(page, "signup-form");
  if (await page.locator("input[name=name]").count()) await page.fill("input[name=name]", "Windows Tester");
  await page.fill("input[name=email]", "qa-windows@joinyourai.test");
  if (await page.locator("input[name=password]").count()) await page.fill("input[name=password]", "qa-windows-fresh-2026!");
  await shot(page, "signup-filled");
  await page.click("button[type=submit]");
  log("submitted signup");
  await new Promise((r) => setTimeout(r, 5000));
  await shot(page, "after-signup");
  writeFileSync(path.join(out, "after-signup.txt"), (await page.evaluate(() => document.body.innerText).catch(() => "")) ?? "");
  await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 180_000 });
  await shot(page, "chat");
  const box = page.locator('textarea, [contenteditable="true"]').last();
  await box.click(); await page.keyboard.type("hey"); await page.keyboard.press("Enter");
  log("sent hey");
  await new Promise((r) => setTimeout(r, mode === "stub" ? 20_000 : 90_000));
  await shot(page, "reply");
  writeFileSync(path.join(out, "reply.txt"), (await page.evaluate(() => document.body.innerText).catch(() => "")) ?? "");
  log("DONE");
} catch (e) { log("FAIL", e.message); process.exitCode = 1;
  for (const w of app.windows()) await shot(w, "fail-window"); }
finally { save(); await app.close().catch(() => {}); }

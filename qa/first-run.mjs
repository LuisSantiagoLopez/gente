// Drives the installed Your AI like a first-time user and screenshots every step.
//   node first-run.mjs <exe> <out-dir> <real|stub> [minutes]
// real: no stand-in model; records what a new user sees during setup (memory check, downloads) for
//       [minutes] (default 12), then stops. It does not wait for a 9-17 GB model on a CPU runner.
// stub: a stand-in model server on 127.0.0.1:11434 lives in this process (a step's background
//       process does not survive on Windows runners), then setup -> sign up -> "hey" -> reply.
// Every line is appended to run.log as it happens, and a watchdog ends the run, so a hang still
// leaves evidence.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";

const [exe, outArg, mode = "stub", minArg] = process.argv.slice(2);
const out = path.resolve(outArg); mkdirSync(out, { recursive: true });
const runLog = path.join(out, "run.log"); writeFileSync(runLog, "");
const t0 = Date.now();
const log = (...a) => { const l = `${new Date().toISOString()} +${Math.round((Date.now() - t0) / 1000)}s ${a.join(" ")}`; console.log(l); appendFileSync(runLog, `${l}\n`); };
const timings = {}; const mark = (s) => { timings[s] = Math.round((Date.now() - t0) / 1000); log(`step ${s}`); writeFileSync(path.join(out, "timings.json"), JSON.stringify(timings, null, 2)); };
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
let n = 0;
const shot = async (p, name) => { n++; const f = path.join(out, `${String(n).padStart(2, "0")}-${name}.png`); await within(p.screenshot({ path: f, timeout: 15_000 }), 20_000).catch((e) => log("shot failed", name, e.message)); log("shot", path.basename(f)); };
const text = async (p, file) => writeFileSync(path.join(out, file), (await within(p.evaluate(() => document.body.innerText), 10_000).catch(() => "")) ?? "");
const budgetMin = Number(minArg ?? (mode === "real" ? 12 : 25));
setTimeout(() => { log(`WATCHDOG: ${budgetMin + 5} min passed, exiting`); process.exit(3); }, (budgetMin + 5) * 60_000).unref();

let stub = null;
if (mode === "stub") {
  const { createOllamaStub } = await import(pathToFileURL(path.join(process.env.GITHUB_WORKSPACE, "apps/desktop/scripts/ollama-stub.mjs")).href);
  stub = createOllamaStub();
  await new Promise((res, rej) => { stub.server.once("error", rej); stub.server.listen(11434, "127.0.0.1", res); });
  log("stand-in model on 127.0.0.1:11434");
}

log("launching", exe, "mode", mode);
const app = await electron.launch({ executablePath: exe, timeout: 180_000 });
mark("launched");
app.process().stdout?.on("data", (d) => appendFileSync(path.join(out, "app-stdout.log"), d));
app.process().stderr?.on("data", (d) => appendFileSync(path.join(out, "app-stderr.log"), d));
let failure = null;
try {
  log("packaged", await app.evaluate(({ app }) => app.isPackaged), "version", await app.evaluate(({ app }) => app.getVersion()));
  const first = await app.firstWindow();
  mark("first-window");
  await first.waitForLoadState("domcontentloaded").catch(() => {});
  await first.waitForSelector("#continue", { timeout: 120_000 }).catch(() => log("no #continue within 2 min"));
  log("first window", first.url(), await first.title().catch(() => ""));
  await shot(first, "first-window"); await text(first, "first-window.txt");
  let clicked = false, page, last = "", lastShot = 0, problemShots = 0;
  const deadline = Date.now() + budgetMin * 60_000;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => !w.isClosed() && w.url().startsWith("http"));
    if (page) break;
    if (!clicked && (await first.isEnabled("#continue", { timeout: 1000 }).catch(() => false))) {
      await first.click("#continue", { timeout: 5000 }).then(() => { clicked = true; mark("clicked-get-started"); }, () => {});
    }
    const state = await within(first.evaluate(() => [
      document.querySelector("#brain-status")?.textContent, document.querySelector("#stack-phase")?.textContent,
      document.querySelector("#stack-output")?.textContent?.slice(-300),
      document.querySelector('[data-tone="error"]')?.textContent ?? null]), 10_000).catch(() => null);
    const line = JSON.stringify(state);
    if (state && line !== last) { last = line; log("setup:", line); }
    if (Date.now() - lastShot > 90_000) { lastShot = Date.now(); await shot(first, "setup-progress"); await text(first, "setup-progress.txt"); }
    if (state?.[3] && problemShots < 3) { problemShots++; await first.click("#stack-details").catch(() => {}); await shot(first, "setup-error"); await text(first, "setup-error.txt"); }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!page) {
    await shot(first, "setup-end"); await text(first, "setup-end.txt");
    if (mode === "real") { log(`REAL: still in setup after ${budgetMin} min (expected on a CPU runner with a multi-GB model download)`); }
    else throw new Error(`app window never opened within ${budgetMin} min`);
  } else {
    mark("workspace-ready");
    log("app window", page.url());
    const appWindowWith = async (sel, ms) => { const end = Date.now() + ms; while (Date.now() < end) { for (const w of app.windows().filter((x) => !x.isClosed() && x.url().startsWith("http"))) if (await w.isVisible(sel).catch(() => false)) return w; await new Promise((r) => setTimeout(r, 1000)); } throw new Error(`no app window showed ${sel}`); };
    await shot(page, "app-window"); await text(page, "app-window.txt");
    page = await appWindowWith("input[name=email]", 120_000);
    mark("signup-form");
    await shot(page, "signup-form");
    if (await page.locator("input[name=name]").count()) await page.fill("input[name=name]", "Windows Tester");
    await page.fill("input[name=email]", "qa-windows@joinyourai.test");
    if (await page.locator("input[name=password]").count()) await page.fill("input[name=password]", "qa-windows-fresh-2026");
    await shot(page, "signup-filled");
    await page.click("button[type=submit]");
    log("submitted signup");
    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 180_000 }).catch(async (e) => { await shot(page, "after-signup"); await text(page, "after-signup.txt"); throw e; });
    mark("signed-up");
    await shot(page, "chat"); await text(page, "chat.txt");
    const box = page.locator('textarea, [contenteditable="true"]').last();
    await box.click(); await page.keyboard.type("hey"); await page.keyboard.press("Enter");
    const sent = Date.now(); log("sent hey");
    if (mode === "stub") await page.getByText("You said: hey").last().waitFor({ timeout: 180_000 });
    else await new Promise((r) => setTimeout(r, 90_000));
    timings["reply-seconds"] = Math.round((Date.now() - sent) / 1000);
    mark("first-reply");
    await shot(page, "reply"); await text(page, "reply.txt");
    log("PASS");
  }
} catch (e) { failure = e; log("FAIL", e?.stack ?? String(e)); }
finally {
  for (const w of app.windows()) await shot(w, "last-window");
  if (stub) writeFileSync(path.join(out, "stub-calls.json"), JSON.stringify(stub.calls.map((c) => c.path), null, 1));
  await within(app.close().catch(() => {}), 30_000);
  log("closed");
}
process.exit(failure ? 1 : 0);

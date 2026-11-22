// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// End to end on a real Mac, entirely in a temp folder (never /Applications):
// a fake "Your AI.app" 1.0.6 sits in a temp Applications folder; a local HTTP server serves a
// real DMG holding 1.0.7 plus latest-mac.yml; one updateNow() (what the Update button's IPC
// call runs) downloads, verifies, mounts, swaps and relaunches with the real `open`.
// Also: a corrupted download changes nothing, and a failed copy rolls back and says so.
import { spawn, spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { createServer, } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DesktopUpdateController } from "../auto-update.js";
import { updateNow } from "../update-now.js";
import type { MacUpdaterDeps } from "./mac-updater.js";
import { MacDmgUpdater, } from "./mac-updater.js";
import { feedYaml, hasClang, makeFakeApp, sha512Base64, TEST_BUNDLE_ID } from "./test-fixtures.js";

vi.mock("../../system/monitoring.js", () => ({ reportDesktopError: vi.fn() }));

// Needs macOS (hdiutil, open) and clang (LaunchServices only opens a real Mach-O).
const onMac = process.platform === "darwin" && hasClang() ? describe : describe.skip;
const DMG = "Your-AI-1.0.7-arm64.dmg";

onMac("Mac one-click update, end to end in a temp folder", () => {
  let root: string;
  let server: Server;
  let base: string;
  let dmgBytes: Buffer;
  let serveCorrupt = false;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "yourai-e2e-"));
    const stage = path.join(root, "stage");
    // Both versions write to one marker, so a relaunch of either one is seen.
    await makeFakeApp(stage, "1.0.7", path.join(root, "launched.txt"), true);
    const dmg = path.join(root, DMG);
    const made = spawnSync("/usr/bin/hdiutil", [
      "create",
      "-quiet",
      "-volname",
      "Your AI",
      "-srcfolder",
      stage,
      "-format",
      "UDZO",
      dmg,
    ]);
    expect(made.status).toBe(0);
    dmgBytes = await readFile(dmg);
    const feed = feedYaml("1.0.7", [
      { url: DMG, sha512: await sha512Base64(dmg), size: dmgBytes.length },
      { url: "Your-AI-1.0.7-x64.dmg", sha512: "unused", size: 1 },
    ]);
    server = createServer((request, response) => {
      if (request.url === "/latest-mac.yml") return response.end(feed);
      if (request.url === `/v1.0.7/${DMG}`) {
        const body = Buffer.from(dmgBytes);
        if (serveCorrupt) body.writeUInt8((body.readUInt8(body.length >> 1) ^ 0xff) & 0xff, body.length >> 1);
        response.setHeader("content-length", body.length);
        return response.end(body);
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    if (!process.env.KEEP_UPDATE_E2E) await rm(root, { recursive: true, force: true });
  });

  /** A fresh 1.0.6 install plus a stand-in app process that "quits" when the updater asks. */
  async function install(name: string, extra: Partial<MacUpdaterDeps["install"]> = {}) {
    const home = path.join(root, name);
    const marker = path.join(root, "launched.txt");
    await rm(marker, { force: true });
    const bundle = await makeFakeApp(path.join(home, "Applications"), "1.0.6", marker, true);
    const appProcess = spawn("/bin/sleep", ["120"]);
    const lines: string[] = [];
    const quit = vi.fn(() => appProcess.kill());
    const deps: MacUpdaterDeps = {
      currentVersion: "1.0.6",
      bundleId: TEST_BUNDLE_ID,
      arch: "arm64",
      execPath: path.join(bundle, "Contents", "MacOS", "Your AI"),
      pid: appProcess.pid!,
      fetcher: (url) => fetch(url),
      downloadDir: path.join(home, "data", "updates"),
      statusFile: path.join(home, "data", "updates", "last-install.txt"),
      logFile: path.join(home, "support.log"),
      log: (line) => lines.push(line),
      quit,
      feed: `${base}/latest-mac.yml`,
      asset: (version, file) => `${base}/v${version}/${file}`,
      install: { workDir: await mkdtemp(path.join(home, "work-")), ...extra },
    };
    const updater = new MacDmgUpdater(deps);
    const controller = new DesktopUpdateController(
      { packaged: true, version: "1.0.6" },
      async () => updater,
      undefined,
      undefined,
      undefined,
      false,
    );
    const click = () =>
      updateNow({
        state: () => controller.state(),
        check: () => controller.check(true),
        download: () => controller.download(),
        install: () => controller.install(),
      });
    /** The install step runs after the click returns, like the real app quitting. */
    const quitOrFail = async () => {
      await waitFor(async () => quit.mock.calls.length > 0 || controller.state().phase === "error");
      expect(lines.join("\n")).not.toContain("install failed");
      expect(quit).toHaveBeenCalledOnce();
    };
    return { home, marker, bundle, quit, controller, click, appProcess, deps, quitOrFail };
  }

  const version = (bundle: string) =>
    spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", `${bundle}/Contents/Info.plist`],
      {
        encoding: "utf8",
      },
    ).stdout.trim();

  async function waitFor(check: () => Promise<boolean>, ms = 60_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("timed out");
  }
  const read = (file: string) => readFile(file, "utf8").catch(() => "");

  it("one click: download, verify, swap, relaunch on 1.0.7", async () => {
    const s = await install("good");
    const progress: number[] = [];
    s.controller.subscribe((state) => state.percent !== null && progress.push(state.percent));
    await s.click();
    await s.quitOrFail();
    await waitFor(async () => (await read(s.marker)).includes("launched 1.0.7"));
    expect(version(s.bundle)).toBe("1.0.7");
    expect(await read(path.join(s.home, "data", "updates", "last-install.txt"))).toBe(
      "installed 1.0.7\n",
    );
    expect(progress.at(-1)).toBe(100);
    await expect(stat(`${s.bundle}.update-backup`)).rejects.toThrow();
  }, 120_000);

  it("a corrupted download changes nothing and offers Try again", async () => {
    serveCorrupt = true;
    const s = await install("corrupt");
    const state = await s.click();
    serveCorrupt = false;
    expect(state.phase).toBe("error");
    expect(state.message).toBe("The update could not be completed. Try again later.");
    expect(s.quit).not.toHaveBeenCalled();
    expect(version(s.bundle)).toBe("1.0.6");
    s.appProcess.kill();
  }, 120_000);

  it("a failed copy rolls back to 1.0.6, relaunches it, and the next check says so", async () => {
    const s = await install("rollback", { copyCommand: "/usr/bin/false" });
    await s.click();
    await s.quitOrFail();
    await waitFor(async () => (await read(s.marker)).includes("launched 1.0.6"));
    expect(version(s.bundle)).toBe("1.0.6");
    expect(await read(path.join(s.home, "support.log"))).toContain("putting the old app back");
    // The relaunched old version reads the helper's result on its first check, once.
    const relaunched = new DesktopUpdateController(
      { packaged: true, version: "1.0.6" },
      async () => new MacDmgUpdater(s.deps),
      undefined,
      undefined,
      undefined,
      false,
    );
    const first = await relaunched.check(true);
    expect(first.phase).toBe("error");
    expect(first.message).toBe("The update could not be completed. Try again later.");
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    expect((await relaunched.check(true)).phase).toBe("available");
  }, 120_000);
});

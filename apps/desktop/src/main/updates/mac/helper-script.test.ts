// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// The swap helper: its text, and (on macOS) real runs on fake bundles in a temp folder:
// a good swap, a rollback when the copy fails, and no change when the app never quits.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helperScript, shellQuote } from "./helper-script.js";
import { makeFakeApp } from "./test-fixtures.js";

const base = {
  pid: 4242,
  target: "/Applications/Your AI.app",
  source: "/tmp/mnt/Your AI.app",
  mountPoint: "/tmp/mnt",
  newVersion: "1.0.7",
  logFile: "/tmp/support.log",
  statusFile: "/tmp/last-install.txt",
  user: { uid: 501, name: "hans" },
};

describe("helperScript text", () => {
  it("quotes every path, even with quotes and dollars", () => {
    expect(shellQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`);
    const text = helperScript({ ...base, target: "/Users/o'neil/Apps/Your $AI.app" });
    expect(text).toContain(`TARGET='/Users/o'\\''neil/Apps/Your $AI.app'`);
    const run = spawnSync("bash", ["-n"], { input: text });
    expect(run.status).toBe(0);
  });

  it("waits for the app, backs up, copies with ditto, clears quarantine, relaunches, unmounts", () => {
    const text = helperScript(base);
    const order = [
      'kill -0 "$PID"',
      'mv "$TARGET" "$BACKUP"',
      '"$COPY" "$SOURCE" "$TARGET"',
      "xattr -dr com.apple.quarantine",
      'mv "$BACKUP" "$TARGET"',
      "\nrelaunch\nunmount",
    ].map((needle) => text.indexOf(needle));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("COPY='/usr/bin/ditto'");
    expect(text).toContain("PID=4242");
  });

  it("relaunches as the person when it runs as root", () => {
    expect(helperScript(base)).toContain(
      `/bin/launchctl asuser "$RUN_UID" /usr/bin/sudo -u "$RUN_USER" "$OPEN" -n "$TARGET"`,
    );
  });
});

const onMac = process.platform === "darwin" ? describe : describe.skip;

async function scene() {
  const root = await mkdtemp(path.join(os.tmpdir(), "yourai-helper-"));
  const marker = path.join(root, "launched.txt");
  const apps = path.join(root, "Applications");
  const target = await makeFakeApp(apps, "1.0.6", marker);
  const source = await makeFakeApp(path.join(root, "mnt"), "1.0.7", marker);
  // Stands in for `open`: runs the bundle's executable directly, like LaunchServices would.
  const opener = path.join(root, "open.sh");
  await writeFile(opener, `#!/bin/bash\n"$2/Contents/MacOS/Your AI"\n`, { mode: 0o755 });
  return { root, marker, target, source, opener };
}

/** Runs the helper without blocking, so Node can reap the stand-in app when it exits. */
async function runHelper(options: Parameters<typeof helperScript>[0]) {
  const script = path.join(path.dirname(options.logFile), "helper.sh");
  await writeFile(script, helperScript(options));
  return new Promise<{ status: number | null }>((resolve) => {
    spawn("/bin/bash", [script], { stdio: "ignore" }).on("exit", (status) => resolve({ status }));
  });
}

const version = async (bundle: string) =>
  spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", `${bundle}/Contents/Info.plist`],
    {
      encoding: "utf8",
    },
  ).stdout.trim();

onMac("helperScript on macOS (temp folders only)", () => {
  it("swaps in the new version after the app quits, and relaunches it", async () => {
    const s = await scene();
    const app = spawn("/bin/sleep", ["1"]);
    await writeFile(path.join(s.target, "Contents", "quarantine-me"), "x");
    spawnSync("xattr", ["-w", "com.apple.quarantine", "0081;0;Safari;", s.source]);
    const run = await runHelper({
      ...base,
      pid: app.pid!,
      target: s.target,
      source: s.source,
      mountPoint: path.join(s.root, "mnt"),
      logFile: path.join(s.root, "support.log"),
      statusFile: path.join(s.root, "status.txt"),
      openCommand: s.opener,
    });
    expect(run.status).toBe(0);
    expect(await version(s.target)).toBe("1.0.7");
    expect(await readFile(path.join(s.root, "status.txt"), "utf8")).toBe("installed 1.0.7\n");
    expect(await readFile(s.marker, "utf8")).toBe("launched 1.0.7\n");
    expect(spawnSync("xattr", ["-p", "com.apple.quarantine", s.target]).status).not.toBe(0);
    await expect(stat(`${s.target}.update-backup`)).rejects.toThrow();
  });

  it("puts the old app back and relaunches it when the copy fails", async () => {
    const s = await scene();
    const run = await runHelper({
      ...base,
      pid: 999_999,
      target: s.target,
      source: s.source,
      mountPoint: path.join(s.root, "mnt"),
      logFile: path.join(s.root, "support.log"),
      statusFile: path.join(s.root, "status.txt"),
      openCommand: s.opener,
      copyCommand: "/usr/bin/false",
    });
    expect(run.status).toBe(0);
    expect(await version(s.target)).toBe("1.0.6");
    expect(await readFile(path.join(s.root, "status.txt"), "utf8")).toBe("rolled-back 1.0.7\n");
    expect(await readFile(s.marker, "utf8")).toBe("launched 1.0.6\n");
    expect(await readFile(path.join(s.root, "support.log"), "utf8")).toContain(
      "putting the old app back",
    );
  });

  it("changes nothing when the app does not quit", async () => {
    const s = await scene();
    const app = spawn("/bin/sleep", ["30"]);
    const run = await runHelper({
      ...base,
      pid: app.pid!,
      target: s.target,
      source: s.source,
      mountPoint: path.join(s.root, "mnt"),
      logFile: path.join(s.root, "support.log"),
      statusFile: path.join(s.root, "status.txt"),
      openCommand: s.opener,
      quitTimeoutSeconds: 1,
    });
    app.kill();
    expect(run.status).toBe(1);
    expect(await version(s.target)).toBe("1.0.6");
    expect(await readFile(path.join(s.root, "status.txt"), "utf8")).toBe("failed 1.0.7\n");
  });
});

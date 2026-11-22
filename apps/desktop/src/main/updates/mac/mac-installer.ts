// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Starts the swap for a verified DMG: mounts it read-only, checks the app inside is ours and is
// the expected version, writes the helper script and starts it detached. When the app folder is
// not writable, the helper starts behind the macOS admin prompt (osascript "with administrator
// privileges"); the person types the password into the system prompt, the app never sees it.
// Every failure here happens while the old app is still running, and unmounts the DMG again.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { helperScript } from "./helper-script.js";

export type Run = (command: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);
export const runCommand: Run = async (command, args) =>
  (await execFileAsync(command, args, { maxBuffer: 4 * 1024 * 1024 })).stdout;

export function startDetached(command: string, args: string[]) {
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

export interface InstallRequest {
  dmg: string;
  version: string;
  bundleId: string;
  target: string;
  needsAdmin: boolean;
  pid: number;
  logFile: string;
  statusFile: string;
  /** Test hooks. */
  run?: Run;
  detach?: (command: string, args: string[]) => void;
  copyCommand?: string;
  openCommand?: string;
  workDir?: string;
}

async function plistValue(run: Run, bundle: string, key: string) {
  const plist = path.join(bundle, "Contents", "Info.plist");
  return (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist])).trim();
}

/** The password prompt, run as the person; a cancel rejects and nothing changes. */
export function adminLaunchArgs(script: string): string[] {
  return [
    "-e",
    "on run argv",
    "-e",
    'do shell script "/bin/bash " & quoted form of (item 1 of argv) & " > /dev/null 2>&1 &" with prompt "Your AI needs your permission to install the update." with administrator privileges',
    "-e",
    "end run",
    script,
  ];
}

/** Resolves once the helper is running; the caller then quits the app. */
export async function startMacInstall(request: InstallRequest): Promise<void> {
  const run = request.run ?? runCommand;
  const detach = request.detach ?? startDetached;
  const work = request.workDir ?? (await mkdtemp(path.join(os.tmpdir(), "yourai-update-")));
  const mountPoint = path.join(work, "mnt");
  await run("/bin/mkdir", ["-p", mountPoint]);
  await run("/usr/bin/hdiutil", [
    "attach",
    "-nobrowse",
    "-readonly",
    "-noautoopen",
    "-mountpoint",
    mountPoint,
    request.dmg,
  ]);
  try {
    const apps = (await readdir(mountPoint)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error("The update disk image has no app inside.");
    const source = path.join(mountPoint, apps[0] as string);
    if ((await plistValue(run, source, "CFBundleIdentifier")) !== request.bundleId) {
      throw new Error("The update disk image holds a different app.");
    }
    if ((await plistValue(run, source, "CFBundleShortVersionString")) !== request.version) {
      throw new Error("The update disk image holds a different version.");
    }
    const script = path.join(work, "update-helper.sh");
    const info = os.userInfo();
    await writeFile(
      script,
      helperScript({
        pid: request.pid,
        target: request.target,
        source,
        mountPoint,
        newVersion: request.version,
        logFile: request.logFile,
        statusFile: request.statusFile,
        user: { uid: info.uid, name: info.username },
        copyCommand: request.copyCommand,
        openCommand: request.openCommand,
      }),
    );
    await chmod(script, 0o700);
    if (request.needsAdmin) await run("/usr/bin/osascript", adminLaunchArgs(script));
    else detach("/bin/bash", [script]);
  } catch (error) {
    await run("/usr/bin/hdiutil", ["detach", mountPoint, "-force", "-quiet"]).catch(() => "");
    throw error;
  }
}

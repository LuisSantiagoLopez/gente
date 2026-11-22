// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Electron glue for the Mac updater: real paths, the app's own HTTP client (net.fetch), the
// support log, and the one-click "Move to Applications" fix. Kept apart so the updater itself
// runs in plain Node for tests.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { app, net } from "electron";
import { machineArch } from "./mac-feed.js";
import { MacDmgUpdater } from "./mac-updater.js";

export interface MacUpdaterPaths {
  /** The app's data folder (~/Library/Application Support/<app>), never the bundle. */
  userDataDir: string;
  /** The folder holding support.log. */
  logDir: string;
}

export function supportLogger(logDir: string) {
  const file = path.join(logDir, "support.log");
  const log = (line: string) =>
    void mkdir(logDir, { recursive: true })
      .then(() => appendFile(file, `${new Date().toISOString()} ${line}\n`))
      .catch(() => undefined);
  return { file, log };
}

export function createMacUpdater(paths: MacUpdaterPaths, quit: () => void) {
  const { file, log } = supportLogger(paths.logDir);
  const updatesDir = path.join(paths.userDataDir, "updates");
  return new MacDmgUpdater({
    currentVersion: app.getVersion(),
    bundleId: "com.gente.app",
    arch: machineArch(process.arch, app.runningUnderARM64Translation),
    execPath: process.execPath,
    pid: process.pid,
    fetcher: (url) => net.fetch(url, { cache: "no-store" }),
    downloadDir: updatesDir,
    statusFile: path.join(updatesDir, "last-install.txt"),
    logFile: file,
    log,
    quit,
  });
}

/** Moves a Mac app run from a DMG or Downloads into /Applications; the app relaunches there. */
export function moveToApplications(logDir: string): boolean {
  const { log } = supportLogger(logDir);
  try {
    const moved = app.moveToApplicationsFolder();
    log(`update: move to Applications ${moved ? "started" : "declined"}`);
    return moved;
  } catch (error) {
    log(`update: move to Applications failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

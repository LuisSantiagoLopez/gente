// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The Mac updater for unsigned builds. Squirrel.Mac refuses apps without a Developer ID, so this
// stands in for electron-updater behind the same interface and events, and the shared
// DesktopUpdateController (and the one Update button) drive it like on Windows:
//   check: read latest-mac.yml, compare versions;
//   download: fetch the DMG for this Mac, verify size + sha512;
//   install: mount, start the helper (see helper-script.ts), quit; the helper relaunches.
import { readFile, rm } from "node:fs/promises";
import type { ElectronAutoUpdater } from "../auto-update.js";
import type { Fetcher } from "./download.js";
import { downloadVerifiedDmg, } from "./download.js";
import { installLocation } from "./install-location.js";
import type {
  MacArch,
  MacFeed,
} from "./mac-feed.js";
import {
  assetUrl,
  feedUrl,
  parseMacFeed,
  pickDmg,
} from "./mac-feed.js";
import type { InstallRequest } from "./mac-installer.js";
import { startMacInstall, } from "./mac-installer.js";
import { isNewerVersion } from "./versions.js";

export interface MacUpdaterDeps {
  currentVersion: string;
  bundleId: string;
  arch: MacArch;
  execPath: string;
  pid: number;
  fetcher: Fetcher;
  /** Folder for downloaded DMGs (inside the app's data folder, not the bundle). */
  downloadDir: string;
  /** The helper writes "installed <v>" or "rolled-back <v>" here. */
  statusFile: string;
  logFile: string;
  log: (line: string) => void;
  quit: () => void;
  feed?: string;
  asset?: (version: string, file: string) => string;
  /** Test hooks passed through to the installer. */
  install?: Partial<InstallRequest>;
}

type Listener = (payload: unknown) => void;

export class MacDmgUpdater implements ElectronAutoUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  disableWebInstaller = true;
  channel: string | null = null;
  private readonly listeners = new Map<string, Listener[]>();
  private found: MacFeed | null = null;
  private downloaded: string | null = null;

  constructor(private readonly deps: MacUpdaterDeps) {}

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  private emit(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  /** Reports a rollback from the last install once, so the person sees it and can retry. */
  private async lastInstallResult() {
    const text = await readFile(this.deps.statusFile, "utf8").catch(() => null);
    if (text === null) return;
    await rm(this.deps.statusFile, { force: true });
    this.deps.log(`update: last install result: ${text.trim()}`);
    if (!text.startsWith("installed")) {
      throw new Error(
        `The last update did not install (${text.trim()}); the old version was kept.`,
      );
    }
  }

  async checkForUpdates() {
    this.emit("checking-for-update");
    await this.lastInstallResult();
    const url = this.deps.feed ?? feedUrl(this.channel === "canary" ? "canary" : "latest");
    const response = await this.deps.fetcher(url);
    if (response.status === 404) throw new Error("cannot find latest-mac.yml (404 not found)");
    if (!response.ok) throw new Error(`Update feed answered HTTP ${response.status}`);
    const feed = parseMacFeed(await response.text());
    if (!isNewerVersion(feed.version, this.deps.currentVersion)) {
      this.found = null;
      this.emit("update-not-available", { version: feed.version });
      return null;
    }
    pickDmg(feed, this.deps.arch);
    this.found = feed;
    this.downloaded = null;
    this.deps.log(`update: ${feed.version} is available (running ${this.deps.currentVersion})`);
    this.emit("update-available", { version: feed.version });
    return { version: feed.version };
  }

  async downloadUpdate() {
    const feed = this.found;
    if (feed === null) throw new Error("No update to download.");
    const location = await installLocation(this.deps.execPath);
    if (location.kind === "translocated" || location.kind === "disk-image") {
      // Classified as "read-only": the UI offers the one-click move to Applications.
      throw new Error(`read-only volume: running from ${location.kind}`);
    }
    const file = pickDmg(feed, this.deps.arch);
    const url = (this.deps.asset ?? assetUrl)(feed.version, file.url);
    this.deps.log(`update: downloading ${file.url}`);
    const dmg = await downloadVerifiedDmg({
      url,
      expected: file,
      dir: this.deps.downloadDir,
      fetcher: this.deps.fetcher,
      onProgress: (percent) => this.emit("download-progress", { percent }),
    });
    this.deps.log(`update: ${file.url} downloaded, sha512 verified`);
    this.downloaded = dmg;
    this.emit("update-downloaded", { version: feed.version, downloadedFile: dmg });
    return [dmg];
  }

  /** Starts the helper, then quits. Failures arrive as "error" while the old app keeps running. */
  quitAndInstall() {
    void this.install().catch((error: unknown) => {
      this.deps.log(`update: install failed: ${error instanceof Error ? error.message : error}`);
      this.emit("error", error);
    });
  }

  private async install() {
    const feed = this.found;
    const dmg = this.downloaded;
    if (feed === null || dmg === null) throw new Error("No downloaded update to install.");
    const location = await installLocation(this.deps.execPath);
    if (location.kind === "translocated" || location.kind === "disk-image") {
      throw new Error(`read-only volume: running from ${location.kind}`);
    }
    await startMacInstall({
      dmg,
      version: feed.version,
      bundleId: this.deps.bundleId,
      target: location.bundle,
      needsAdmin: location.kind === "needs-admin",
      pid: this.deps.pid,
      logFile: this.deps.logFile,
      statusFile: this.deps.statusFile,
      ...this.deps.install,
    });
    this.deps.log(`update: helper started for ${feed.version}; quitting`);
    this.deps.quit();
  }
}

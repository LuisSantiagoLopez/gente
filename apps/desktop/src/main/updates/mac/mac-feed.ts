// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Reads latest-mac.yml (the electron-builder feed format) and picks the DMG for this Mac:
// arm64 for Apple Silicon (also when the app runs under Rosetta), x64 for Intel.
// Each file entry must carry a sha512 (base64) and a size, or the feed is refused.
import { parse } from "yaml";

export interface FeedFile {
  url: string;
  sha512: string;
  size: number;
}

export interface MacFeed {
  version: string;
  files: FeedFile[];
}

/** Where the public installers live. The source repo is private; this one has releases only. */
export const RELEASES_REPO = "LuisSantiagoLopez/yourai-releases";

export function feedUrl(channel: "latest" | "canary" = "latest") {
  const name = channel === "canary" ? "canary-mac.yml" : "latest-mac.yml";
  return `https://github.com/${RELEASES_REPO}/releases/latest/download/${name}`;
}

/** Assets are read from the version's own tag, so a newer release mid-download cannot mix in. */
export function assetUrl(version: string, file: string) {
  return `https://github.com/${RELEASES_REPO}/releases/download/v${version}/${encodeURIComponent(file)}`;
}

export function parseMacFeed(text: string): MacFeed {
  const raw = (parse(text) ?? {}) as { version?: unknown; files?: unknown };
  if (typeof raw.version !== "string" || raw.version.trim() === "") {
    throw new Error("The update feed did not include a version.");
  }
  if (!Array.isArray(raw.files)) throw new Error("The update feed lists no files.");
  const files: FeedFile[] = [];
  for (const entry of raw.files as Record<string, unknown>[]) {
    const { url, sha512, size } = entry ?? {};
    if (typeof url !== "string" || typeof sha512 !== "string" || typeof size !== "number") continue;
    // Only plain file names; a feed must not point the download somewhere else.
    if (url.includes("/") || url.includes("..")) continue;
    files.push({ url, sha512, size });
  }
  return { version: raw.version.trim(), files };
}

export type MacArch = "arm64" | "x64";

/** The machine's real architecture: an x64 build under Rosetta still gets the arm64 DMG. */
export function machineArch(processArch: string, runningUnderRosetta: boolean): MacArch {
  return processArch === "arm64" || runningUnderRosetta ? "arm64" : "x64";
}

export function pickDmg(feed: MacFeed, arch: MacArch): FeedFile {
  const suffix = `-${arch}.dmg`;
  const file = feed.files.find((entry) => entry.url.toLowerCase().endsWith(suffix));
  if (!file) throw new Error(`cannot find latest-mac.yml entry for ${arch} dmg`);
  return file;
}

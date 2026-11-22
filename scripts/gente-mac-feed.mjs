// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Writes latest-mac.yml for the Mac updater from the two release DMGs (arm64 and x64), with the
// size and sha512 (base64) of each. The app refuses a DMG whose hash does not match this file.
// Usage: node scripts/gente-mac-feed.mjs <folder with the DMGs> > latest-mac.yml
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const NAME = /^Your-AI-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(arm64|x64)\.dmg$/;

async function sha512(file) {
  const hash = createHash("sha512");
  await pipeline(createReadStream(file), hash);
  return hash.digest("base64");
}

/** Builds the feed text; fails unless exactly one arm64 and one x64 DMG of one version exist. */
export async function macFeed(dir, releaseDate = new Date().toISOString()) {
  const dmgs = (await readdir(dir)).filter((name) => NAME.test(name)).sort();
  const versions = new Set(dmgs.map((name) => NAME.exec(name)[1]));
  const arches = dmgs.map((name) => NAME.exec(name)[2]).sort();
  if (versions.size !== 1 || arches.join(",") !== "arm64,x64") {
    throw new Error(
      `Need one arm64 and one x64 DMG of one version, found: ${dmgs.join(", ") || "none"}`,
    );
  }
  const [version] = versions;
  const files = [];
  for (const name of dmgs) {
    const file = path.join(dir, name);
    files.push({ url: name, sha512: await sha512(file), size: (await stat(file)).size });
  }
  const arm = files.find((file) => file.url.endsWith("-arm64.dmg"));
  const lines = [`version: ${version}`, "files:"];
  for (const file of files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
  }
  lines.push(`path: ${arm.url}`, `sha512: ${arm.sha512}`, `releaseDate: '${releaseDate}'`);
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(await macFeed(process.argv[2] ?? "."));
}

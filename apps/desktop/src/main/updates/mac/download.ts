// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Downloads the DMG with the app's own HTTP client (so macOS adds no quarantine flag), reports
// progress, and checks the file's size and sha512 against the feed before anything installs.
// A partial or wrong file is deleted; the old app is never touched by this step.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FeedFile } from "./mac-feed.js";

export type Fetcher = (url: string) => Promise<Response>;

/** sha512 of a file, base64, the way electron-builder writes it into latest-mac.yml. */
export async function sha512File(file: string): Promise<string> {
  const hash = createHash("sha512");
  await pipeline(createReadStream(file), hash);
  return hash.digest("base64");
}

/** Throws a "sha512 checksum mismatch" error unless size and hash both match. */
export async function verifyDownload(file: string, expected: FeedFile): Promise<void> {
  const { size } = await stat(file);
  if (size !== expected.size) {
    throw new Error(`sha512 checksum mismatch: size ${size}, expected ${expected.size}`);
  }
  const actual = await sha512File(file);
  if (actual !== expected.sha512) throw new Error("sha512 checksum mismatch");
}

export interface DownloadOptions {
  url: string;
  expected: FeedFile;
  /** Folder for the finished DMG. */
  dir: string;
  fetcher: Fetcher;
  onProgress: (percent: number) => void;
}

/** Returns the path of a verified DMG. */
export async function downloadVerifiedDmg(options: DownloadOptions): Promise<string> {
  const { url, expected, dir, fetcher, onProgress } = options;
  await mkdir(dir, { recursive: true });
  const final = path.join(dir, path.basename(expected.url));
  const partial = `${final}.part`;
  await rm(partial, { force: true });
  // A verified copy from an earlier try is reused instead of downloading again.
  try {
    await verifyDownload(final, expected);
    onProgress(100);
    return final;
  } catch {
    await rm(final, { force: true });
  }
  // Older updates' disk images are not needed once a new one is wanted.
  for (const name of await readdir(dir)) {
    if (name.endsWith(".dmg") || name.endsWith(".dmg.part"))
      await rm(path.join(dir, name), { force: true });
  }
  const response = await fetcher(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  let received = 0;
  let lastPercent = -1;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      const percent = Math.min(99, Math.floor((received / expected.size) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
      controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(counter) as never),
      createWriteStream(partial),
    );
    await verifyDownload(partial, expected);
    await rename(partial, final);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  onProgress(100);
  return final;
}

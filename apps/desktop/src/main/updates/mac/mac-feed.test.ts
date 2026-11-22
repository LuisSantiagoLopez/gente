// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// latest-mac.yml parsing, DMG choice per Mac, feed URLs, and the release script that writes it.
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The release script is plain JavaScript without types.
import { macFeed } from "../../../../../../scripts/gente-mac-feed.mjs";
import { verifyDownload } from "./download.js";
import { assetUrl, feedUrl, machineArch, parseMacFeed, pickDmg } from "./mac-feed.js";
import { feedYaml } from "./test-fixtures.js";

const feed = parseMacFeed(
  feedYaml("1.0.7", [
    { url: "Your-AI-1.0.7-arm64.dmg", sha512: "a", size: 1 },
    { url: "Your-AI-1.0.7-x64.dmg", sha512: "b", size: 2 },
  ]),
);

describe("mac feed", () => {
  it("reads version and files", () => {
    expect(feed.version).toBe("1.0.7");
    expect(feed.files.map((file) => file.url)).toEqual([
      "Your-AI-1.0.7-arm64.dmg",
      "Your-AI-1.0.7-x64.dmg",
    ]);
  });

  it("picks the DMG for this Mac", () => {
    expect(pickDmg(feed, "arm64").url).toBe("Your-AI-1.0.7-arm64.dmg");
    expect(pickDmg(feed, "x64").url).toBe("Your-AI-1.0.7-x64.dmg");
  });

  it("gives Apple Silicon the arm64 DMG even under Rosetta", () => {
    expect(machineArch("arm64", false)).toBe("arm64");
    expect(machineArch("x64", true)).toBe("arm64");
    expect(machineArch("x64", false)).toBe("x64");
  });

  it("fails when this Mac's DMG is missing, as a missing feed (no install)", () => {
    const armOnly = parseMacFeed(
      feedYaml("1.0.7", [{ url: "Your-AI-1.0.7-arm64.dmg", sha512: "a", size: 1 }]),
    );
    expect(() => pickDmg(armOnly, "x64")).toThrow("cannot find latest-mac.yml");
  });

  it("drops entries without a hash or size, and entries that point elsewhere", () => {
    const parsed = parseMacFeed(`version: 1.0.7
files:
  - url: Your-AI-1.0.7-arm64.dmg
    size: 5
  - url: ../evil/Your-AI-1.0.7-x64.dmg
    sha512: x
    size: 5
  - url: https://evil.example/Your-AI-1.0.7-x64.dmg
    sha512: x
    size: 5
`);
    expect(parsed.files).toEqual([]);
  });

  it("refuses a feed without a version", () => {
    expect(() => parseMacFeed("files: []\n")).toThrow("did not include a version");
  });

  it("reads from the public downloads repo, assets from the version's own tag", () => {
    expect(feedUrl()).toBe(
      "https://github.com/LuisSantiagoLopez/yourai-releases/releases/latest/download/latest-mac.yml",
    );
    expect(feedUrl("canary")).toContain("/canary-mac.yml");
    expect(assetUrl("1.0.7", "Your-AI-1.0.7-arm64.dmg")).toBe(
      "https://github.com/LuisSantiagoLopez/yourai-releases/releases/download/v1.0.7/Your-AI-1.0.7-arm64.dmg",
    );
  });

  it("release script writes a feed whose hashes verify both DMGs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mac-feed-"));
    await writeFile(path.join(dir, "Your-AI-1.0.7-arm64.dmg"), "arm image");
    await writeFile(path.join(dir, "Your-AI-1.0.7-x64.dmg"), "intel image!");
    const written = parseMacFeed(await macFeed(dir, "2026-11-22T00:00:00.000Z"));
    expect(written.version).toBe("1.0.7");
    for (const arch of ["arm64", "x64"] as const) {
      const file = pickDmg(written, arch);
      await expect(verifyDownload(path.join(dir, file.url), file)).resolves.toBeUndefined();
    }
  });

  it("release script refuses a single DMG or mixed versions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mac-feed-"));
    await writeFile(path.join(dir, "Your-AI-1.0.7-arm64.dmg"), "a");
    await expect(macFeed(dir)).rejects.toThrow("Need one arm64 and one x64");
    await writeFile(path.join(dir, "Your-AI-1.0.6-x64.dmg"), "b");
    await expect(macFeed(dir)).rejects.toThrow("Need one arm64 and one x64");
  });
});

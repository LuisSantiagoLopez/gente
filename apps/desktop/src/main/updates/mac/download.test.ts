// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// The DMG download: progress, size + sha512 check, and nothing kept when the file is wrong.
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadVerifiedDmg, sha512File, verifyDownload } from "./download.js";

const body = Buffer.alloc(300_000, 7);
const expected = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dl-ref-"));
  const file = path.join(dir, "ref");
  await writeFile(file, body);
  return { url: "Your-AI-1.0.7-arm64.dmg", sha512: await sha512File(file), size: body.length };
};
const serve = (data: Buffer) => async () => new Response(new Uint8Array(data));

describe("downloadVerifiedDmg", () => {
  it("downloads with progress and keeps only a verified file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dl-"));
    await writeFile(path.join(dir, "Your-AI-1.0.6-arm64.dmg"), "old update");
    const progress: number[] = [];
    const file = await downloadVerifiedDmg({
      url: "https://example.test/x.dmg",
      expected: await expected(),
      dir,
      fetcher: serve(body),
      onProgress: (percent) => progress.push(percent),
    });
    expect(path.basename(file)).toBe("Your-AI-1.0.7-arm64.dmg");
    expect(progress.at(-1)).toBe(100);
    expect(progress.length).toBeGreaterThan(1);
    expect(await readdir(dir)).toEqual(["Your-AI-1.0.7-arm64.dmg"]);
  });

  it("refuses and deletes a corrupted download", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dl-"));
    const corrupted = Buffer.from(body);
    corrupted[1234] = 0;
    await expect(
      downloadVerifiedDmg({
        url: "https://example.test/x.dmg",
        expected: await expected(),
        dir,
        fetcher: serve(corrupted),
        onProgress: () => {},
      }),
    ).rejects.toThrow("sha512 checksum mismatch");
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a short download and an HTTP error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dl-"));
    const options = { url: "u", expected: await expected(), dir, onProgress: () => {} };
    await expect(
      downloadVerifiedDmg({ ...options, fetcher: serve(body.subarray(0, 10)) }),
    ).rejects.toThrow("sha512 checksum mismatch: size 10");
    await expect(
      downloadVerifiedDmg({ ...options, fetcher: async () => new Response("no", { status: 404 }) }),
    ).rejects.toThrow("HTTP 404");
    expect(await readdir(dir)).toEqual([]);
  });

  it("verifyDownload compares the base64 sha512", async () => {
    const ref = await expected();
    const dir = await mkdtemp(path.join(os.tmpdir(), "dl-"));
    const file = path.join(dir, "f");
    await writeFile(file, body);
    await expect(verifyDownload(file, ref)).resolves.toBeUndefined();
    await expect(verifyDownload(file, { ...ref, sha512: "AAAA" })).rejects.toThrow("mismatch");
  });
});

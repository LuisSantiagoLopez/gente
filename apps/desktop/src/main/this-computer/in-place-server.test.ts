// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installServerBundle, readServerBundle } from "./mac-runtime.js";

describe("Gente runs its server from inside the app", () => {
  it("uses the unpacked server in the app's resources: nothing downloaded, nothing unpacked", async () => {
    const resources = await mkdtemp(path.join(os.tmpdir(), "gente-res-"));
    const server = path.join(resources, "rakazo-server");
    await mkdir(server, { recursive: true });
    await writeFile(
      path.join(server, "manifest.json"),
      JSON.stringify({ version: "0.2.0", entrypoints: { api: "a.js", worker: "w.js", web: "web.js", migrate: "m.js" } }),
    );
    await writeFile(
      path.join(resources, "server-bundle.json"),
      JSON.stringify({ url: "https://example.test/x.tar.xz", sha256: "a".repeat(64), size: 1, version: "0.2.0" }),
    );
    const bundle = await readServerBundle({ resourcesPath: resources, packaged: true });
    expect(bundle).toEqual({ version: "0.2.0", inPlace: server });
    const fail = async () => {
      throw new Error("must not download or unpack");
    };
    const installed = await installServerBundle(
      { dir: path.join(resources, "runtime"), run: fail, fetch: fail, env: {}, signal: new AbortController().signal, onBytes: () => {}, onLine: () => {} } as never,
      bundle!,
    );
    expect(installed.dir).toBe(server);
  });
});

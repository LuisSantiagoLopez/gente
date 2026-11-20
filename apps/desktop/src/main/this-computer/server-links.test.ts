// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureServerLinks, SERVER_LINKS_FILE } from "./server-links.js";

describe("server links (Windows ships the server without pnpm's links)", () => {
  it("puts each link back once, then leaves correct links alone", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gente-links-"));
    mkdirSync(path.join(dir, "node_modules", ".pnpm", "zod@4", "node_modules", "zod"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", ".pnpm", "zod@4", "node_modules", "zod", "index.js"), "ok");
    writeFileSync(
      path.join(dir, SERVER_LINKS_FILE),
      JSON.stringify([["apps/api/node_modules/zod", "node_modules/.pnpm/zod@4/node_modules/zod"]]),
    );
    expect(ensureServerLinks(dir)).toBe(1);
    expect(readFileSync(path.join(dir, "apps", "api", "node_modules", "zod", "index.js"), "utf8")).toBe("ok");
    expect(ensureServerLinks(dir)).toBe(0);
  });

  it("refuses a link that points outside the server", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gente-links-"));
    writeFileSync(path.join(dir, SERVER_LINKS_FILE), JSON.stringify([["a", "../../etc"]]));
    expect(() => ensureServerLinks(dir)).toThrow(/outside/);
  });
});

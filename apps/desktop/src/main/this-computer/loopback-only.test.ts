// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// QA-003: nothing Gente starts on a person's computer may listen on every network interface.
// This scans the desktop main process for listen addresses and the hosts it gives its servers.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = path.resolve(import.meta.dirname, "..");
const sources = readdirSync(main, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => [f, readFileSync(path.join(main, f), "utf8")] as const);

describe("loopback only", () => {
  it("never binds 0.0.0.0 or ::", () => {
    const offenders = sources.flatMap(([file, text]) =>
      [...text.matchAll(/["'`](0\.0\.0\.0|::)["'`]/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("gives the API, the web server and the host computer a loopback host", () => {
    const all = sources.map(([, text]) => text).join("\n");
    for (const name of ["API_HOST", "WEB_HOST"]) {
      const hosts = [...all.matchAll(new RegExp(`${name}: "([^"]+)"`, "g"))].map((m) => m[1]);
      expect(hosts.length, name).toBeGreaterThan(0);
      for (const host of hosts) expect(host, name).toBe("127.0.0.1");
    }
    expect(all).toContain('HOST_COMPUTER_HOST = "127.0.0.1"');
  });
});

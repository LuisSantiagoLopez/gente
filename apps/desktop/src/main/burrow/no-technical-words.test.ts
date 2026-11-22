// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente never puts technical words on screen. This scans every string the app can show: the setup
// page, the desktop app's translated strings, Gente's calm messages and the web app's English
// catalog. Technical detail belongs in the log files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CALM } from "./brain.js";
import { CALM_FAILURE, CALM_OFFLINE } from "./self-heal.js";

const TECHNICAL = [
  /\bHTTP\s*(\d{3}|\{)/,
  /WebSocket/i,
  /\bE(CONN\w*|NOENT|ADDRINUSE|TIMEDOUT|AI_AGAIN|NOTFOUND)\b/,
  /stack ?trace|Traceback|at Object\./i,
  // Beginners don't know the tools under the hood.
  /\bOllama\b/,
];
const root = path.resolve(import.meta.dirname, "../../../../..");
const desktopMain = path.join(root, "apps/desktop/src/main");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "locales") files(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function shownStrings(): string[] {
  const strings: string[] = [];
  for (const file of files(desktopMain))
    for (const m of readFileSync(file, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g))
      strings.push(m[1]!);
  const setup = path.join(root, "apps/desktop/src/setup-renderer");
  strings.push(readFileSync(path.join(setup, "setup.html"), "utf8").replace(/<[^>]+>/g, " "));
  for (const m of readFileSync(path.join(setup, "setup.js"), "utf8").matchAll(
    /\bt\(\s*"((?:[^"\\]|\\.)*)"/g,
  ))
    strings.push(m[1]!);
  for (const m of readFileSync(
    path.join(root, "packages/i18n/locales/en/messages.po"),
    "utf8",
  ).matchAll(/^msgid "(.*)"$/gm))
    strings.push(m[1]!);
  strings.push(
    CALM_FAILURE,
    CALM_OFFLINE,
    CALM.offline,
    CALM.install,
    CALM.ollama,
    CALM.memory,
    CALM.space(20),
  );
  return strings;
}

describe("no technical words on screen", () => {
  it("finds no HTTP codes, socket names, errno codes or stack traces in any shown string", () => {
    const offenders = shownStrings().filter((s) => TECHNICAL.some((re) => re.test(s)));
    expect(offenders).toEqual([]);
  });
});

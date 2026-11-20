// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A signature names one kind of failure, the same on every computer: the error code, where in
// Gente's code it happened, and the message with everything that varies (numbers, paths, ids)
// taken out. The self-healing pipeline groups incoming reports by it.
//
// Only node:crypto: the pipeline imports this file as it is (scripts/self-heal).
import { createHash } from "node:crypto";

export type FailureFacts = {
  /** Gente's own code for the failure, e.g. OLLAMA_DOWN or BUNDLE_MODULE_MISSING. */
  code: string;
  /** Where it came from: "main", "renderer", "api", "worker", "setup", "health". */
  source: string;
  message?: string;
  stack?: string;
};

/** The message with what varies between computers removed. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s'"]*|\/[^\s'"]*/g, "<path>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\b\d+(\.\d+)*\b/g, "<n>")
    .replace(/'[^']*'|"[^"]*"/g, "<text>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** The first frames that point into Gente's own code, file and function only (no lines). */
export function topFrames(stack: string | undefined, count = 3): string[] {
  if (!stack) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = /^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::\d+){0,2}\)?\s*$/.exec(line);
    if (!match) continue;
    const file = match[2] ?? "";
    if (/node:internal|node_modules|^internal\//.test(file)) continue;
    const base = file.split(/[/\\]/).pop() ?? file;
    frames.push(`${match[1] ?? "<anonymous>"}@${base}`);
    if (frames.length >= count) break;
  }
  return frames;
}

export function failureSignature(facts: FailureFacts): string {
  const key = [
    facts.code,
    facts.source,
    normalizeMessage(facts.message ?? ""),
    ...topFrames(facts.stack),
  ].join("|");
  return `${facts.code}-${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
}

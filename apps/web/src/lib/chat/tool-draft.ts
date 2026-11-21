// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/** Argument names whose value is the body being written: a file, code, a message. */
const BODY_KEYS = ["content", "contents", "code", "text", "body", "html", "script", "command"];
const PATH_KEYS = ["path", "file_path", "filePath", "filename", "file"];

/** Reads a JSON string value that may still be cut off, from just after its opening quote. */
function readPartialString(source: string, start: number): { value: string; closed: boolean } {
  let value = "";
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') return { value, closed: true };
    if (char !== "\\") {
      value += char;
      continue;
    }
    const next = source[i + 1];
    if (next === undefined) break;
    i += 1;
    if (next === "n") value += "\n";
    else if (next === "t") value += "\t";
    else if (next === "r") value += "\r";
    else if (next === "b") value += "\b";
    else if (next === "f") value += "\f";
    else if (next === "u") {
      const hex = source.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
    } else value += next;
  }
  return { value, closed: false };
}

function stringField(args: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(args);
    if (match) return readPartialString(args, match.index + match[0].length).value;
  }
  return undefined;
}

/**
 * What a tool call being written is about to do, from its arguments so far: the body it writes
 * (decoded as it streams) and the file it names. Arguments without a body show as they are.
 */
export function toolDraftPreview(args: string): { path?: string; body: string; isBody: boolean } {
  const path = stringField(args, PATH_KEYS);
  const body = stringField(args, BODY_KEYS);
  if (body !== undefined) return { path, body, isBody: true };
  return { path, body: args, isBody: false };
}

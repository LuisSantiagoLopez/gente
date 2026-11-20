// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/** One line of a line diff: kept, removed from the old text, or added in the new one. */
export type DiffLine = { op: " " | "-" | "+"; text: string };

/** Above this many cells the table would be too big; the diff then replaces the whole text. */
const MAX_DIFF_CELLS = 4_000_000;
const CONTEXT_LINES = 3;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Longest-common-subsequence line diff. Small inputs only; SKILL.md files are a few KB. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      ...a.map((text) => ({ op: "-" as const, text })),
      ...b.map((text) => ({ op: "+" as const, text })),
    ];
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: " ", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ op: "-", text: a[i]! });
      i += 1;
    } else {
      out.push({ op: "+", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ op: "-", text: a[i++]! });
  while (j < b.length) out.push({ op: "+", text: b[j++]! });
  return out;
}

/** Lines the new text adds (as a multiset: a line moved elsewhere is not "added"). */
export function addedLines(before: string, after: string): string[] {
  return diffLines(before, after)
    .filter((line) => line.op === "+")
    .map((line) => line.text);
}

/** A unified diff (`--- a/SKILL.md` / `+++ b/SKILL.md`, @@ hunks with 3 lines of context). */
export function unifiedDiff(before: string, after: string, file = "SKILL.md"): string {
  const lines = diffLines(before, after);
  const changed = lines.flatMap((line, index) => (line.op === " " ? [] : [index]));
  if (changed.length === 0) return "";
  // Group changes whose context windows touch into one hunk.
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, index + CONTEXT_LINES);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }
  const out = [`--- a/${file}`, `+++ b/${file}`];
  for (const [start, end] of hunks) {
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k += 1) {
      if (lines[k]!.op !== "+") oldStart += 1;
      if (lines[k]!.op !== "-") newStart += 1;
    }
    const slice = lines.slice(start, end + 1);
    const oldCount = slice.filter((line) => line.op !== "+").length;
    const newCount = slice.filter((line) => line.op !== "-").length;
    out.push(
      `@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`,
    );
    for (const line of slice) out.push(`${line.op}${line.text}`);
  }
  return `${out.join("\n")}\n`;
}

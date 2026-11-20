// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * A thread ledger is the structured shape of a compacted chat summary: what was decided, what is
 * known, what is still open, what the user prefers, and a short story of the recent turns. Every
 * item cites the message sequence it came from (`[seq 20]`), so later compactions can carry an
 * item forward when the summarizer forgets it, and drop it only when the summarizer marks it
 * resolved or superseded.
 */

export const LEDGER_SECTIONS = ["Decisions", "Facts", "Open loops", "Preferences"] as const;
export type LedgerSection = (typeof LEDGER_SECTIONS)[number];

/** Items the summarizer says are done or replaced. Never rendered, only used while merging. */
export const RESOLVED_SECTION = "Resolved";
export const STORY_SECTION = "Recent story";

export type LedgerItem = { text: string; seqs: number[] };

export type ThreadLedger = {
  sections: Record<LedgerSection, LedgerItem[]>;
  resolved: LedgerItem[];
  story: string;
};

const HEADING = /^#{1,6}\s*(.+?)\s*:?\s*$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const SEQ_CITATION = /\[\s*seqs?\s*([\d\s,–-]+)\]/gi;

function emptySections(): Record<LedgerSection, LedgerItem[]> {
  return { Decisions: [], Facts: [], "Open loops": [], Preferences: [] };
}

function sectionFor(heading: string): LedgerSection | "resolved" | "story" | null {
  const key = heading
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();
  if (key.startsWith("decision")) return "Decisions";
  if (key.startsWith("fact")) return "Facts";
  if (key.startsWith("open")) return "Open loops";
  if (key.startsWith("preference")) return "Preferences";
  if (key.startsWith("resolved") || key.startsWith("superseded")) return "resolved";
  if (key.includes("story") || key.startsWith("recent") || key.startsWith("narrative"))
    return "story";
  return null;
}

function citedSeqs(text: string): number[] {
  const seqs = new Set<number>();
  for (const match of text.matchAll(SEQ_CITATION)) {
    for (const part of match[1]!.split(",")) {
      const range = part.trim().split(/[–-]/);
      const from = Number.parseInt(range[0] ?? "", 10);
      const to = Number.parseInt(range[1] ?? "", 10);
      if (Number.isInteger(from)) seqs.add(from);
      if (Number.isInteger(to)) seqs.add(to);
    }
  }
  return [...seqs].sort((left, right) => left - right);
}

/** Reads a ledger, or returns null when the text has none of the ledger sections. */
export function parseThreadLedger(text: string | null | undefined): ThreadLedger | null {
  if (!text?.trim()) return null;
  const ledger: ThreadLedger = { sections: emptySections(), resolved: [], story: "" };
  let current: LedgerSection | "resolved" | "story" | null = null;
  let sawSection = false;
  const story: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      const section = sectionFor(heading[1]!);
      if (section) {
        current = section;
        sawSection = true;
        continue;
      }
    }
    if (current === "story") {
      story.push(line);
      continue;
    }
    if (!current) continue;
    const bullet = BULLET.exec(line);
    const body = (bullet ? bullet[1]! : line).trim();
    if (!body || /^\(?none\)?\.?$/i.test(body)) continue;
    const item = { text: body, seqs: citedSeqs(body) };
    const items = current === "resolved" ? ledger.resolved : ledger.sections[current];
    // A wrapped line continues the item above it.
    if (!bullet && items.length > 0) items[items.length - 1]!.text += ` ${body}`;
    else items.push(item);
  }
  if (!sawSection) return null;
  ledger.story = story.join("\n").trim();
  return ledger;
}

function normalized(text: string): string {
  return text
    .replace(SEQ_CITATION, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sameItem(left: LedgerItem, right: LedgerItem): boolean {
  const a = normalized(left.text);
  const b = normalized(right.text);
  if (a && a === b) return true;
  // A reworded item about the same cited message replaces the older wording. One message can
  // hold several facts, so the wording must also mostly agree.
  if (!left.seqs.some((seq) => right.seqs.includes(seq))) return false;
  const leftWords = new Set(a.split(" "));
  const rightWords = new Set(b.split(" "));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return shared / Math.max(1, Math.min(leftWords.size, rightWords.size)) >= 0.6;
}

function resolvedBy(item: LedgerItem, resolved: LedgerItem[]): boolean {
  const text = normalized(item.text);
  return resolved.some((done) => {
    // The summarizer cites the message of the item it closes, so a shared citation is enough.
    if (sameItem(item, done) || item.seqs.some((seq) => done.seqs.includes(seq))) return true;
    const doneText = normalized(done.text);
    return doneText.length >= 12 && (text.includes(doneText) || doneText.includes(text));
  });
}

export function renderThreadLedger(ledger: ThreadLedger): string {
  const parts: string[] = [];
  for (const section of LEDGER_SECTIONS) {
    const items = ledger.sections[section];
    parts.push(
      `## ${section}\n${items.length ? items.map((item) => `- ${item.text}`).join("\n") : "- (none)"}`,
    );
  }
  if (ledger.story) parts.push(`## ${STORY_SECTION}\n${ledger.story}`);
  return parts.join("\n\n");
}

function firstSeq(item: LedgerItem): number {
  return item.seqs[0] ?? Number.POSITIVE_INFINITY;
}

/**
 * Fits a ledger in `maxChars`: first shortens the story, then drops the oldest carried facts and
 * preferences, then the oldest decisions. Open loops go last, since they are what is still owed.
 */
function fitLedger(ledger: ThreadLedger, maxChars: number): string {
  let rendered = renderThreadLedger(ledger);
  if (rendered.length <= maxChars) return rendered;
  const overflow = rendered.length - maxChars;
  if (ledger.story) {
    const keep = Math.max(0, ledger.story.length - overflow - 1);
    ledger.story = keep > 40 ? `…${ledger.story.slice(ledger.story.length - keep + 1)}` : "";
    rendered = renderThreadLedger(ledger);
  }
  const dropOrder: LedgerSection[] = ["Facts", "Preferences", "Decisions", "Open loops"];
  for (const section of dropOrder) {
    while (rendered.length > maxChars && ledger.sections[section].length > 0) {
      const items = ledger.sections[section];
      let oldest = 0;
      for (let index = 1; index < items.length; index += 1)
        if (firstSeq(items[index]!) < firstSeq(items[oldest]!)) oldest = index;
      items.splice(oldest, 1);
      rendered = renderThreadLedger(ledger);
    }
  }
  return rendered.length <= maxChars ? rendered : rendered.slice(0, maxChars);
}

/**
 * Merges the summarizer's new ledger with the previous one. Decisions, facts, open loops and
 * preferences the model left out are carried forward unless it listed them under Resolved. A reply
 * with no ledger sections keeps the previous ledger and uses the reply as the story, so a
 * forgetful or off-format summary never erases what was known. Text that was never a ledger, on
 * either side, is returned as the model wrote it.
 */
export function mergeThreadLedger(
  previousSummary: string | null | undefined,
  nextSummary: string,
  maxChars: number,
): string {
  const previous = parseThreadLedger(previousSummary);
  const next = parseThreadLedger(nextSummary);
  if (!next && !previous) return nextSummary;
  const merged: ThreadLedger = next ?? {
    sections: emptySections(),
    resolved: [],
    story: nextSummary.trim(),
  };
  if (previous) {
    for (const section of LEDGER_SECTIONS) {
      const kept = merged.sections[section];
      const carried = previous.sections[section].filter(
        (item) =>
          !resolvedBy(item, merged.resolved) &&
          !LEDGER_SECTIONS.some((any) => merged.sections[any].some((now) => sameItem(item, now))),
      );
      merged.sections[section] = [...carried, ...kept].sort(
        (left, right) => firstSeq(left) - firstSeq(right),
      );
    }
  }
  merged.resolved = [];
  return fitLedger(merged, maxChars);
}

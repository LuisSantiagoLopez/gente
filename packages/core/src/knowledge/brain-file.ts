// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Brain, BrainCitation, BrainFact } from "@rakazo/contracts";
import { BrainCitationSchema } from "@rakazo/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * A brain is one topic's knowledge file: what Gente learned from research and feedback, each fact
 * with where it came from. It is stored as plain markdown so a person can read and edit it:
 *
 *   ---
 *   topic: Running shoes
 *   keywords: [running, shoes]
 *   updated: 2026-11-19T10:00:00.000Z
 *   ---
 *   # Running shoes
 *
 *   - Santi runs 40 km a week. [1] · 2026-11-19
 *
 *   ## Sources
 *   [1] message msg_1 — "I run 40 km a week"
 */

export const BRAIN_PATH_PREFIX = "brains/";
export const MAX_BRAIN_FACTS = 80;
export const MAX_BRAIN_BYTES = 16_000;
export const MAX_BRAIN_KEYWORDS = 24;
/** Written for a fact the person typed in by hand, which has no other source. */
export const USER_CITATION: BrainCitation = { kind: "user", ref: "you" };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FACT_LINE = /^\s*[-*]\s+(.+?)\s*$/;
const FACT_REFS = /\s*\[(\d+(?:\s*,\s*\d+)*)\]\s*(?:·\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const SOURCE_LINE = /^\s*\[(\d+)\]\s+(\w+)\s+(\S+)(?:\s+—\s+(.*))?\s*$/;

export function brainSlug(topic: string): string {
  const slug = topic
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "topic";
}

export function brainPath(slug: string): string {
  return `${BRAIN_PATH_PREFIX}${slug}.md`;
}

export function slugFromBrainPath(path: string): string | null {
  if (!path.startsWith(BRAIN_PATH_PREFIX) || !path.endsWith(".md")) return null;
  return path.slice(BRAIN_PATH_PREFIX.length, -3) || null;
}

function citationKey(citation: BrainCitation): string {
  return `${citation.kind}:${citation.ref}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function serializeBrain(brain: Brain): string {
  const sources: BrainCitation[] = [];
  const indexOf = new Map<string, number>();
  const lines = brain.facts.map((fact) => {
    const refs = fact.citations.map((citation) => {
      const key = citationKey(citation);
      let index = indexOf.get(key);
      if (index === undefined) {
        sources.push(citation);
        index = sources.length;
        indexOf.set(key, index);
      }
      return index;
    });
    return `- ${oneLine(fact.text)} [${refs.join(", ")}] · ${dateOnly(fact.addedAt)}`;
  });
  const frontmatter = stringifyYaml(
    { topic: brain.topic, keywords: brain.keywords, updated: brain.updatedAt },
    { flowCollectionPadding: false, collectionStyle: "flow" },
  ).trimEnd();
  const sourceLines = sources.map((source, index) => {
    const label = source.label ? ` — ${oneLine(source.label)}` : "";
    return `[${index + 1}] ${source.kind} ${source.ref.replace(/\s+/g, "%20")}${label}`;
  });
  return [
    "---",
    frontmatter,
    "---",
    `# ${oneLine(brain.topic)}`,
    "",
    ...lines,
    "",
    "## Sources",
    ...sourceLines,
    "",
  ].join("\n");
}

/**
 * Reads a brain file, including one a person edited. A fact whose numbers point at no source is
 * kept as the person's own, cited to them, so an edit never silently drops knowledge.
 */
export function parseBrain(content: string, fallback: { slug: string; now: string }): Brain {
  const match = FRONTMATTER.exec(content.replace(/^﻿/, ""));
  let meta: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed = parseYaml(match[1] ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      meta = {};
    }
  }
  const body = match ? content.slice(match[0].length) : content;
  const [factPart, sourcePart = ""] = body.split(/^##\s+Sources\s*$/m);
  const sources = new Map<number, BrainCitation>();
  for (const line of sourcePart.split("\n")) {
    const source = SOURCE_LINE.exec(line);
    if (!source) continue;
    const parsed = BrainCitationSchema.safeParse({
      kind: source[2],
      ref: source[3]!.replace(/%20/g, " "),
      ...(source[4] ? { label: source[4].slice(0, 200) } : {}),
    });
    if (parsed.success) sources.set(Number(source[1]), parsed.data);
  }
  const heading = /^#\s+(.+)$/m.exec(factPart ?? "")?.[1]?.trim();
  const topic = (typeof meta.topic === "string" && meta.topic.trim()) || heading || fallback.slug;
  const facts: BrainFact[] = [];
  for (const line of (factPart ?? "").split("\n")) {
    const factLine = FACT_LINE.exec(line);
    if (!factLine) continue;
    let text = factLine[1]!;
    let citations: BrainCitation[] = [];
    let addedAt = fallback.now;
    const refs = FACT_REFS.exec(text);
    if (refs) {
      text = text.slice(0, refs.index);
      citations = refs[1]!
        .split(",")
        .map((n) => sources.get(Number(n.trim())))
        .filter((citation): citation is BrainCitation => Boolean(citation));
      if (refs[2]) addedAt = new Date(`${refs[2]}T00:00:00.000Z`).toISOString();
    }
    text = oneLine(text).slice(0, 600);
    if (!text) continue;
    facts.push({
      text,
      citations: dedupeCitations(citations.length ? citations : [USER_CITATION]),
      addedAt,
    });
  }
  const keywords = Array.isArray(meta.keywords)
    ? meta.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const updated =
    typeof meta.updated === "string" && !Number.isNaN(Date.parse(meta.updated))
      ? new Date(meta.updated).toISOString()
      : fallback.now;
  return {
    slug: fallback.slug,
    topic: oneLine(topic).slice(0, 120),
    keywords: normalizeKeywords(keywords),
    facts,
    updatedAt: updated,
  };
}

export function normalizeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of keywords) {
    const clean = oneLine(keyword).toLowerCase().slice(0, 40);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length === MAX_BRAIN_KEYWORDS) break;
  }
  return out;
}

function dedupeCitations(citations: readonly BrainCitation[]): BrainCitation[] {
  const seen = new Set<string>();
  const out: BrainCitation[] = [];
  for (const citation of citations) {
    const key = citationKey(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out.slice(0, 8);
}

/** Lowercase words of three or more letters, with a plural "s" dropped. */
export function knowledgeTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]{3,}/g) ?? []
  )
    .filter((word) => !STOPWORDS.has(word))
    .map((word) =>
      word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word,
    );
}

const STOPWORDS = new Set(
  "the and for with that this from are was were has have had you your our their they them not but all any can will would should could into onto about what when where which who why how its it's than then there here also just very more most some such only over under out use using used".split(
    " ",
  ),
);

function sameFact(left: string, right: string): boolean {
  const a = new Set(knowledgeTokens(left));
  const b = new Set(knowledgeTokens(right));
  if (a.size === 0 || b.size === 0)
    return oneLine(left).toLowerCase() === oneLine(right).toLowerCase();
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared) >= 0.8;
}

export interface BrainUpdate {
  topic: string;
  keywords: string[];
  facts: Array<{ text: string; citations: BrainCitation[] }>;
  /** Facts of the existing brain, by text, that the new facts make wrong. */
  replaces?: string[];
}

/**
 * Adds distilled facts to a brain. A fact Gente already knows gains the new sources instead of a
 * copy; a fact without a source is dropped; facts the update replaces go. The newest facts are
 * kept when the file would pass its fact or size limit.
 */
export function mergeBrain(existing: Brain | null, update: BrainUpdate, now: string): Brain {
  const slug = existing?.slug ?? brainSlug(update.topic);
  const replaced = new Set((update.replaces ?? []).map((text) => oneLine(text).toLowerCase()));
  const facts: BrainFact[] = (existing?.facts ?? [])
    .filter((fact) => !replaced.has(oneLine(fact.text).toLowerCase()))
    .map((fact) => ({ ...fact, citations: [...fact.citations] }));
  for (const incoming of update.facts) {
    const text = oneLine(incoming.text).slice(0, 600);
    const citations = dedupeCitations(
      incoming.citations.filter((c) => BrainCitationSchema.safeParse(c).success),
    );
    if (!text || citations.length === 0) continue;
    const known = facts.find((fact) => sameFact(fact.text, text));
    if (known) {
      known.citations = dedupeCitations([...known.citations, ...citations]);
      known.addedAt = now;
      continue;
    }
    facts.push({ text, citations, addedAt: now });
  }
  facts.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  let kept = facts.slice(-MAX_BRAIN_FACTS);
  const brain: Brain = {
    slug,
    topic: existing?.topic ?? (oneLine(update.topic).slice(0, 120) || slug),
    keywords: normalizeKeywords([...(existing?.keywords ?? []), ...update.keywords]),
    facts: kept,
    updatedAt: now,
  };
  while (
    kept.length > 1 &&
    new TextEncoder().encode(serializeBrain({ ...brain, facts: kept })).length > MAX_BRAIN_BYTES
  ) {
    kept = kept.slice(1);
  }
  return { ...brain, facts: kept };
}

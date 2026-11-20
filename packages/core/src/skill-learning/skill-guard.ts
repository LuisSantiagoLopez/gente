// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { parseSkillMd } from "../skills/agent-skill.js";
import { addedLines } from "./skill-diff.js";

/**
 * What a learned change may never do. A skill learns how to do work better; it never gains the
 * power to do more, spend more, or ask less. This is a conservative, deterministic gate: a
 * false alarm only means the change waits for the person to make it by hand.
 */
export type SkillGuardRule = "permissions" | "spend" | "approval";

export type SkillGuardViolation = {
  rule: SkillGuardRule;
  /** The frontmatter key or added line that tripped the rule. */
  evidence: string;
};

export type SkillGuardResult = { ok: true } | { ok: false; violations: SkillGuardViolation[] };

/** Frontmatter keys that grant or limit power. A learned change may not add, drop or edit any. */
const GUARDED_KEYS: Array<[RegExp, SkillGuardRule]> = [
  [/^(allowed|disallowed|denied)?[-_ ]?tools?$/, "permissions"],
  [
    /^(permissions?|scopes?|capabilit(y|ies)|access|network|hosts?|domains?|secrets?)$/,
    "permissions",
  ],
  [/^(budget|spend(ing)?|cost|max[-_ ]?(spend|cost|price|amount)|limits?|price|payment)/, "spend"],
  [/(approv|confirm|consent|review|ask[-_ ]?(first|before)|human[-_ ]?in)/, "approval"],
];

/**
 * Added instructions that would let the skill spend money, act or speak as the person, delete
 * their data, accept legal terms, or get around a confirmation. Matched only on lines the change
 * adds, so text the person already wrote stays as it is.
 */
const GUARDED_LINES: Array<[RegExp, SkillGuardRule]> = [
  [
    /\b(pay|pays|paying|paid|purchase|buy|buying|checkout|check out|charge|place (the |an |the )?order|subscribe|upgrade (the )?plan|transfer (money|funds)|wire|tip)\b/i,
    "spend",
  ],
  [/[$€£¥]\s?\d|\b\d+(\.\d+)?\s?(usd|eur|dollars|euros|pesos)\b/i, "spend"],
  [
    /\b(send|sends|sending|post|posting|publish|reply|replies|email|e-mail|text|dm|tweet)\b[^.\n]*\b(as (me|the user|them|him|her)|on (my|their|his|her) behalf|from (my|their|his|her) (account|email|phone|number)|without (asking|checking|showing|confirm))/i,
    "approval",
  ],
  [
    /\b(delete|deletes|deleting|erase|wipe|purge|remove|removing|trash|overwrite)\b[^.\n]*\b(files?|folders?|data|emails?|messages?|contacts?|photos?|records?|documents?|docs?|accounts?|backups?|history|events?|notes?|repos?|repositor(y|ies)|branch(es)?|rows?|tables?|everything|all)\b/i,
    "permissions",
  ],
  [
    /(\brm\s+-[a-z]*r[a-z]*f|\bdrop (table|database)\b|\bempty (the )?trash\b|\bclose (my|the|their) account\b|\bfactory reset\b)/i,
    "permissions",
  ],
  [
    /\b(accept|agree to|agreeing to|sign|e-sign|consent to|click ["']?(i agree|accept))\b[^.\n]*\b(terms|agreement|contract|conditions|eula|tos|policy|nda|lease)\b/i,
    "approval",
  ],
  [
    /\b(skip|skipping|bypass|bypassing|ignore|ignoring|without|no need to|don'?t|do not|never|stop)\b[^.\n]*\b(ask(ing)?|confirm(ation|ing)?|approv(al|e|ing)|check(ing)? with|permission)\b/i,
    "approval",
  ],
  [/\b(auto[- ]?approve|auto[- ]?confirm|always (approve|allow|say yes))\b/i, "approval"],
];

function normalizedKey(key: string): string {
  return key.trim().toLowerCase();
}

function guardedKeyRule(key: string): SkillGuardRule | null {
  const normalized = normalizedKey(key);
  for (const [pattern, rule] of GUARDED_KEYS) if (pattern.test(normalized)) return rule;
  return null;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** Checks that `after` keeps every power limit `before` had and grants nothing new. */
export function checkSkillChangeSafety(before: string, after: string): SkillGuardResult {
  const violations: SkillGuardViolation[] = [];
  const old = parseSkillMd(before);
  const next = parseSkillMd(after);
  const oldFront = "error" in old ? {} : old.frontmatter;
  const nextFront = "error" in next ? {} : next.frontmatter;
  const keys = new Set([...Object.keys(oldFront), ...Object.keys(nextFront)]);
  for (const key of keys) {
    const rule = guardedKeyRule(key);
    if (!rule) continue;
    if (stable(oldFront[key]) !== stable(nextFront[key])) {
      violations.push({ rule, evidence: `${key} (setting)` });
    }
  }
  for (const line of addedLines(before, after)) {
    const text = line.trim();
    if (!text || text === "---") continue;
    // Frontmatter lines were judged by key above.
    if (/^[A-Za-z_][\w-]*:/.test(text) && guardedKeyRule(text.slice(0, text.indexOf(":"))))
      continue;
    for (const [pattern, rule] of GUARDED_LINES) {
      if (pattern.test(text)) {
        violations.push({ rule, evidence: text.slice(0, 200) });
        break;
      }
    }
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}

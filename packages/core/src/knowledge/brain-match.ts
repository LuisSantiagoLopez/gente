// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Brain, BrainFact } from "@rakazo/contracts";
import { knowledgeTokens } from "./brain-file.js";

export const MAX_LOADED_BRAINS = 3;
/** Characters of brain facts one turn may carry, across every brain it loads. */
export const MAX_LOADED_BRAIN_CHARS = 6_000;

export interface MatchedBrain {
  brain: Brain;
  score: number;
  /** The facts that fit the budget, most relevant first. */
  facts: BrainFact[];
}

function brainTerms(brain: Brain): Set<string> {
  return new Set([...knowledgeTokens(brain.topic), ...brain.keywords.flatMap(knowledgeTokens)]);
}

/**
 * The brains a message is about: a brain counts when the message names its topic or one of its
 * keywords. Ties go to the brain updated last. Facts are picked by how many of the message's
 * words they share, then by age, until the shared character budget is spent.
 */
export function matchBrains(
  prompt: string,
  brains: readonly Brain[],
  options: { maxBrains?: number; maxChars?: number; extraSlugs?: readonly string[] } = {},
): MatchedBrain[] {
  const maxBrains = options.maxBrains ?? MAX_LOADED_BRAINS;
  let budget = options.maxChars ?? MAX_LOADED_BRAIN_CHARS;
  const words = new Set(knowledgeTokens(prompt));
  const forced = new Set(options.extraSlugs ?? []);
  const scored = brains
    .map((brain) => {
      let score = 0;
      for (const term of brainTerms(brain)) if (words.has(term)) score += 1;
      if (forced.has(brain.slug)) score += 100;
      return { brain, score };
    })
    .filter((entry) => entry.score > 0 && entry.brain.facts.length > 0)
    .sort((a, b) => b.score - a.score || b.brain.updatedAt.localeCompare(a.brain.updatedAt))
    .slice(0, maxBrains);
  const matched: MatchedBrain[] = [];
  for (const { brain, score } of scored) {
    const ranked = brain.facts
      .map((fact, index) => ({
        fact,
        index,
        overlap: knowledgeTokens(fact.text).filter((token) => words.has(token)).length,
      }))
      .sort((a, b) => b.overlap - a.overlap || b.index - a.index);
    const facts: BrainFact[] = [];
    for (const { fact } of ranked) {
      const cost = fact.text.length + 40;
      if (cost > budget) continue;
      budget -= cost;
      facts.push(fact);
    }
    if (facts.length) matched.push({ brain, score, facts });
    if (budget <= 40) break;
  }
  return matched;
}

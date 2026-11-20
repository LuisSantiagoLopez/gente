// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { BrainDistillOutputSchema } from "@rakazo/contracts";
import type { DistillSource } from "./brain-distill.prompt.js";
import type { BrainUpdate } from "./brain-file.js";

/** The first balanced JSON object in a model answer, which may wrap it in a fence or prose. */
function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Turns the distiller's answer into brain updates. A fact keeps only the source numbers that
 * exist, and a fact left with none is dropped: nothing reaches a brain without a citation.
 */
export function parseBrainDistillation(
  answer: string,
  sources: readonly DistillSource[],
): BrainUpdate[] {
  const parsed = BrainDistillOutputSchema.safeParse(firstJsonObject(answer));
  if (!parsed.success) return [];
  return parsed.data.brains
    .map((brain) => ({
      topic: brain.topic,
      keywords: brain.keywords.filter((keyword) => typeof keyword === "string"),
      replaces: brain.replaces,
      facts: brain.facts.flatMap((fact) => {
        const citations = [...new Set(fact.sources)]
          .map((n) => sources[n - 1]?.citation)
          .filter((citation) => citation !== undefined);
        return citations.length ? [{ text: fact.text, citations }] : [];
      }),
    }))
    .filter((brain) => brain.facts.length > 0);
}

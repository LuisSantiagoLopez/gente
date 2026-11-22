// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Says whether the person asked the AI to think a message through ("think carefully",
// "piensa bien", "step by step"). Fast chat turns thinking off for short questions and for the
// first step of a task; a message like this keeps it on, so the thinking shows live in the chat.
// Called by burrow-fast-chat.ts (quickChatBody).

/** Words that ask for careful thought, in English, Spanish and Portuguese. */
const THINK_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[
    "think|thinking|carefully|step by step|reason it out|reason through|in depth|deeply|thoroughly",
    "piensa|pi[eé]nsalo|pensar|razona|razonar|con cuidado|detenidamente|a fondo|paso a paso|cuidadosamente",
    "pense|pensa|com cuidado|passo a passo|profundamente",
  ].join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

/** The thinking level used when the person asked for careful thought. */
export const ASKED_THINKING_EFFORT = "low";

export function asksToThink(words: string): boolean {
  return THINK_WORDS.test(words);
}

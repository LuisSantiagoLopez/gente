// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Text the bot wrote just before a question card is posted above the card (run-progress.ts,
// publishNarrationBeforeAsk). Questions in it would be questions outside the card, which the
// person cannot answer with a click, so they are taken out and only the rest is posted.

/** The text without its questions: every sentence that ends in a question mark. */
export function withoutQuestions(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/[^.!?\n]*\?+["”»)]*/gu, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();
}

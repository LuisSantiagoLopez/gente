// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * A long scripted chat for recall tests: 1000 turns (a user message and a reply each) about
 * everyday work, with one fact planted early and a few look-alike words elsewhere.
 */

export const PLANTED_TURN = 20;
export const PLANTED_CODE_NAME = "MARIGOLD-7";
export const PLANTED_FACT = `Please remember this: the project code name is ${PLANTED_CODE_NAME}. Don't share it outside the team.`;
export const RECALL_QUESTION = "Quick check: what was the project code name I gave you?";

export type ScriptedMessage = { seq: number; role: "user" | "bot"; text: string; turn: number };

const TOPICS = [
  ["lunch", "Book a table for four at the taco place on Thursday."],
  ["invoice", "Draft the invoice for the March design work, 12 hours."],
  ["flight", "Find a morning flight to Monterrey next Tuesday."],
  ["slides", "Tighten the slides for the board update, keep it to eight."],
  ["gym", "Move my gym session to 7 pm."],
  ["review", "Remind me to do the code review for the login page."],
  ["groceries", "Add oat milk, eggs and coffee to the grocery list."],
  ["rename", "Rename the shared folder to Q3 Planning."],
  ["hiring", "Summarize the three designer candidates in two lines each."],
  ["budget", "How much is left in the marketing budget this month?"],
  ["birthday", "Ana's birthday is soon; suggest a gift under 50 dollars."],
  ["email", "Write a polite follow-up to the supplier about the late order."],
] as const;

/** Turn `turn` (1-based) as a user message and the reply to it. */
export function scriptedTurn(turn: number): [string, string] {
  if (turn === PLANTED_TURN)
    return [PLANTED_FACT, `Got it, the code name is ${PLANTED_CODE_NAME}.`];
  const [topic, ask] = TOPICS[turn % TOPICS.length]!;
  return [`${ask} (note ${turn})`, `Done with the ${topic} item for note ${turn}.`];
}

export function scriptedThread(turns: number): ScriptedMessage[] {
  const messages: ScriptedMessage[] = [];
  for (let turn = 1; turn <= turns; turn += 1) {
    const [user, bot] = scriptedTurn(turn);
    messages.push({ seq: messages.length, role: "user", text: user, turn });
    messages.push({ seq: messages.length, role: "bot", text: bot, turn });
  }
  return messages;
}

/**
 * A forgetful scripted summarizer: it writes a ledger of only the newest batch (anything the user
 * asked to remember becomes a fact, an unanswered last ask becomes an open loop), so earlier items survive
 * only if the merge carries them forward.
 */
export function scriptedLedgerSummary(
  batch: Array<{ seq: number; speaker: string; text: string }>,
): string {
  const asks = batch.filter((message) => message.speaker === "User");
  const facts = asks
    .filter((message) => /remember/i.test(message.text))
    .map((message) => `- [seq ${message.seq}] ${message.text}`);
  // An ask still open is one with no reply after it in the batch.
  const last = batch.at(-1)?.speaker === "User" ? batch.at(-1) : undefined;
  return [
    "## Decisions",
    "- (none)",
    "## Facts",
    ...(facts.length ? facts : ["- (none)"]),
    "## Open loops",
    last ? `- [seq ${last.seq}] ${last.text}` : "- (none)",
    "## Preferences",
    "- (none)",
    "## Resolved",
    "- (none)",
    "## Recent story",
    `Worked through messages ${batch[0]?.seq} to ${batch.at(-1)?.seq}.`,
  ].join("\n");
}

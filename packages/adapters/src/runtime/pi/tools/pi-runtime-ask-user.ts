// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// What happens when the model calls ask_user: its questions become one card the person
// answers, and the run pauses until they do. Called from pi-runtime-tools.ts (toAgentTool).
// The answer comes back as this call's result when the run resumes (pi-runtime.ts, restore).
import type { Message } from "@earendil-works/pi-ai";
import { ASK_MORE_QUESTIONS_MAX } from "@rakazo/core";
import { ASK_CARDS_LIMIT_RESULT } from "./pi-runtime-asks.prompt.js";
import type { ToolHost } from "./pi-runtime-tools.js";

/** Question cards one task may ask before it must decide for itself. */
export const ASK_CARDS_PER_TASK = 2;

/** The model's extra questions, kept in shape so the schema can check them. */
export function preparedMoreQuestions(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return {};
  return {
    more_questions: raw.map((item) => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        question: String(entry.question ?? ""),
        // Kept as-is when invalid, so the schema's minItems rejects it instead of an empty list.
        options: Array.isArray(entry.options) ? entry.options.map(String) : entry.options,
      };
    }),
  };
}

/** Ids stay unique across a card's questions: the first question's options keep choice-N. */
function askActions(options: readonly string[], question: number) {
  return options.map((label, index) => ({
    id: question === 0 ? `choice-${index + 1}` : `q${question + 1}-choice-${index + 1}`,
    label,
  }));
}

/** Every question of an ask_user call, checked: each has a question and two to four options. */
function askUserQuestions(args: Record<string, unknown>) {
  const more = Array.isArray(args.more_questions) ? args.more_questions : [];
  const all = [
    { question: args.question, options: args.options },
    ...more.map(
      (item) => (item && typeof item === "object" ? item : {}) as Record<string, unknown>,
    ),
  ].slice(0, 1 + ASK_MORE_QUESTIONS_MAX);
  return all.map((item) => {
    const options = Array.isArray(item.options)
      ? item.options.map((option) => String(option).trim())
      : [];
    if (
      options.length < 2 ||
      options.length > 4 ||
      options.some((option) => option.length === 0 || option.length > 80) ||
      new Set(options).size !== options.length
    ) {
      throw new Error("ask_user requires two to four unique, non-empty options for each question");
    }
    return { question: String(item.question ?? "").trim() || "What should I use?", options };
  });
}

/**
 * Shows the card and pauses the run. A task asks at most a couple of cards; past that the model
 * is told, truthfully, that no card was shown and it must decide for itself. (It is never told it
 * has an answer it does not have: that is what made a lost-answer reply in 1.0.5.)
 */
export function askUserCard(
  host: Pick<ToolHost, "askedCards" | "pausePending" | "queue" | "request">,
  args: Record<string, unknown>,
  executionId: string,
) {
  if ((host.askedCards ?? 0) >= ASK_CARDS_PER_TASK) {
    return { content: [{ type: "text" as const, text: ASK_CARDS_LIMIT_RESULT }], details: args };
  }
  const [first, ...more] = askUserQuestions(args);
  host.pausePending = true;
  host.askedCards = (host.askedCards ?? 0) + 1;
  host.queue.push({
    type: "ask",
    ...(host.request.onCheckpoint ? { executionId } : {}),
    text: first!.question,
    ...(typeof args.detail === "string" && args.detail ? { detail: args.detail } : {}),
    actions: askActions(first!.options, 0),
    ...(more.length
      ? {
          questions: more.map((question, index) => ({
            text: question.question,
            actions: askActions(question.options, index + 1),
          })),
        }
      : {}),
  });
  return {
    content: [{ type: "text" as const, text: "Waiting for the user's choice." }],
    details: args,
    terminate: true,
  };
}

/** How many question cards a restored task already asked, so resuming keeps the count. */
export function askUserCalls(messages: readonly unknown[]): number {
  let count = 0;
  for (const message of messages as Message[]) {
    if (message.role !== "assistant") continue;
    for (const part of message.content)
      if (part.type === "toolCall" && part.name === "ask_user") count += 1;
  }
  return count;
}

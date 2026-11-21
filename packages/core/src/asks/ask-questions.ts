// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { resolveAskChoice } from "./answerable-ask.js";

/** Questions a card may ask under its first one, so a few questions go in one card. */
export const ASK_MORE_QUESTIONS_MAX = 3;
/** The longest typed "Something else" answer to one question. */
export const ASK_TYPED_ANSWER_MAX = 500;

type Action = { id: string; label: string };
export type AskQuestion = { text: string; actions: Action[] };

/** Every question a card asks, in order: its own, then the ones under it. */
export function askQuestions(block: {
  text: string;
  actions?: readonly Action[];
  questions?: readonly { text: string; actions: readonly Action[] }[];
}): AskQuestion[] {
  return [
    { text: block.text, actions: [...(block.actions ?? [])] },
    ...(block.questions ?? []).map((question) => ({
      text: question.text,
      actions: [...question.actions],
    })),
  ];
}

/** The answer a card with several questions sends: one per question, an option id or typed text. */
export function encodeAskAnswers(answers: readonly string[]): string {
  return JSON.stringify({ answers: answers.map((answer) => answer.trim()) });
}

/** One answer per question, or undefined when the text is not a full set of card answers. */
export function decodeAskAnswers(answer: string, count: number): string[] | undefined {
  if (!answer.trim().startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return undefined;
  }
  const answers = (parsed as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers) || answers.length !== count) return undefined;
  if (
    !answers.every(
      (item) =>
        typeof item === "string" && item.trim() !== "" && item.length <= ASK_TYPED_ANSWER_MAX,
    )
  )
    return undefined;
  return answers.map((item) => (item as string).trim());
}

/** Each answer in words: the option's label, or what the person typed. */
export function askAnswerLabels(questions: readonly AskQuestion[], answers: readonly string[]) {
  return questions.map(
    (question, index) =>
      resolveAskChoice(answers[index] ?? "", question.actions)?.label ?? answers[index] ?? "",
  );
}

/** What the bot is told: each question with the person's answer. */
export function askAnswersText(questions: readonly AskQuestion[], answers: readonly string[]) {
  const labels = askAnswerLabels(questions, answers);
  return [
    "The person answered the question card:",
    ...questions.map(
      (question, index) => `${index + 1}. ${question.text}\nAnswer: ${labels[index]}`,
    ),
  ].join("\n");
}

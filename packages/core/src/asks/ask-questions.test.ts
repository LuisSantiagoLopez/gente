import { describe, expect, it } from "vitest";
import {
  askAnswersText,
  askQuestions,
  decodeAskAnswers,
  encodeAskAnswers,
} from "./ask-questions.js";

const card = {
  text: "What is the site for?",
  actions: [
    { id: "choice-1", label: "A shop" },
    { id: "choice-2", label: "A landing page" },
  ],
  questions: [
    {
      text: "Which style?",
      actions: [
        { id: "q2-choice-1", label: "Calm" },
        { id: "q2-choice-2", label: "Bold" },
      ],
    },
  ],
};

describe("question cards with several questions", () => {
  it("lists the card's own question first", () => {
    expect(askQuestions(card).map((question) => question.text)).toEqual([
      "What is the site for?",
      "Which style?",
    ]);
  });

  it("round-trips one answer per question and refuses a partial set", () => {
    const sent = encodeAskAnswers(["choice-2", " Pastel colors "]);
    expect(decodeAskAnswers(sent, 2)).toEqual(["choice-2", "Pastel colors"]);
    expect(decodeAskAnswers(sent, 3)).toBeUndefined();
    expect(decodeAskAnswers(encodeAskAnswers(["choice-1", ""]), 2)).toBeUndefined();
    expect(decodeAskAnswers("A shop", 2)).toBeUndefined();
  });

  it("tells the bot each question with the chosen label or the typed text", () => {
    expect(askAnswersText(askQuestions(card), ["choice-2", "Pastel colors"])).toBe(
      "The person answered the question card:\n1. What is the site for?\nAnswer: A landing page\n2. Which style?\nAnswer: Pastel colors",
    );
  });
});

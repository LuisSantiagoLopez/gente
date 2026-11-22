import { describe, expect, it } from "vitest";
import { withoutQuestions } from "./narration-questions.js";

describe("narration before a question card", () => {
  it("keeps statements and drops questions", () => {
    expect(
      withoutQuestions(
        "I'll build it with sensible defaults. What's the name of your shop?\nAlso, what are your hours?\n\nThe rest I can pick.",
      ),
    ).toBe("I'll build it with sensible defaults.\n\nThe rest I can pick.");
    expect(withoutQuestions("¿Cómo se llama tu café?")).toBe("");
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// End to end through the real Pi runtime and a model server emulator: the model asks a card,
// the person clicks, and the model's next request carries that answer as the ask_user result.
// It also covers the 1.0.5 bug: a follow-up card after an answer must show, not be swallowed.
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { askAnswersText, askQuestions } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "../../../adapters/src/runtime/pi/pi-runtime.js";
import { builtinAgentTools } from "../../../adapters/src/tools/builtin.tool-definition.js";
import { startModelEmulator } from "../model-emulator.js";

async function collect(events: AsyncIterable<AgentRuntimeEvent>) {
  const result: AgentRuntimeEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

const toolResult = (
  request: { messages: Array<{ role: string; tool_call_id?: string }> },
  id: string,
) =>
  JSON.stringify(
    request.messages.find((message) => message.role === "tool" && message.tool_call_id === id),
  );

describe("question card answers reach the model", () => {
  it("sends the clicked options as the ask_user result and allows one follow-up card", async () => {
    const seen: string[] = [];
    const model = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: {
            type: "tool",
            id: "card-1",
            name: "ask_user",
            arguments: {
              question: "What is the site for?",
              options: ["A shop", "A landing page"],
              more_questions: [{ question: "Which style?", options: ["Calm", "Bold"] }],
            },
          },
        },
        {
          expect(request) {
            seen.push(toolResult(request, "card-1"));
          },
          response: {
            type: "tool",
            id: "card-2",
            name: "ask_user",
            arguments: { question: "Which color?", options: ["Blue", "Green"] },
          },
        },
        {
          expect(request) {
            seen.push(toolResult(request, "card-2"));
          },
          response: {
            type: "tool",
            id: "card-3",
            name: "ask_user",
            arguments: { question: "Which font?", options: ["Serif", "Sans"] },
          },
        },
        {
          expect(request) {
            seen.push(toolResult(request, "card-3"));
          },
          response: { type: "text", text: "Building it now." },
        },
      ],
    });
    let capture: (() => string) | undefined;
    const request: AgentRunRequest = {
      runId: "fixture-ask-answer",
      botId: "fixture-bot",
      threadId: "fixture-thread",
      instructions: "Build what the person asks.",
      prompt: "make me a website",
      history: [],
      model: model.model,
      tools: builtinAgentTools.filter((tool) => tool.name === "ask_user"),
      onCheckpoint: async (snapshot) => {
        capture = snapshot;
      },
    };
    try {
      // 1. The model asks two questions on one card.
      const first = await collect(new PiAgentRuntime().run(request));
      const card = first.find((event) => event.type === "ask");
      expect(card).toMatchObject({
        text: "What is the site for?",
        questions: [{ text: "Which style?" }],
      });
      // 2. The person picks "A landing page" and types "Pastel" for the style. The server
      // turns that into the text the resumed call returns (commitAnswerRunInput).
      const answer = askAnswersText(
        askQuestions(card as { text: string; actions: []; questions: [] }),
        ["choice-2", "Pastel"],
      );
      const second = await collect(
        new PiAgentRuntime().run({
          ...request,
          turnCheckpoint: capture!(),
          resumeToolResult: { content: [{ type: "text", text: answer }] },
        }),
      );
      expect(seen[0]).toContain("Answer: A landing page");
      expect(seen[0]).toContain("Answer: Pastel");
      // 3. A follow-up card after an answer is shown (1.0.5 swallowed it and told the model
      // it already had an answer, so it replied that the selection was lost).
      expect(second.filter((event) => event.type === "ask")).toMatchObject([
        { text: "Which color?" },
      ]);
      await collect(
        new PiAgentRuntime().run({
          ...request,
          turnCheckpoint: capture!(),
          resumeToolResult: { content: [{ type: "text", text: "Selected choice choice-1: Blue" }] },
        }),
      );
      expect(seen[1]).toContain("Blue");
      // 4. A third card is over the limit: the model is told no card was shown.
      expect(seen[2]).toContain("No card was shown");
      model.assertComplete();
    } finally {
      await model.close();
    }
  });
});

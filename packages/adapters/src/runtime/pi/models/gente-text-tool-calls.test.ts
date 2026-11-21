// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import type { OfferedTool } from "./gente-text-tool-calls.js";
import { filterTextToolCalls, offeredTools, readTextToolCalls } from "./gente-text-tool-calls.js";

const askUser: OfferedTool = {
  name: "ask_user",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      detail: { type: "string" },
      options: { type: "array" },
    },
    required: ["question", "options"],
  },
};
const remember: OfferedTool = {
  name: "remember",
  parameters: {
    type: "object",
    properties: { content: { type: "string" } },
    required: ["content"],
  },
};
const TOOLS = [askUser, remember];

// Santi's screenshot: the model wrote ask_user as text, then a quoted list.
const SCREENSHOT = `ask_user: "¡Hola, Test! Soy g. ¿Qué quieres que haga?"
- "Redactar textos"
- "Buscar información"
- "Organizar mi día"
- "Lo que tú me digas"`;

describe("tool calls written as text", () => {
  it("reads the XML call form newer Qwen templates teach", () => {
    const read = readTextToolCalls(
      "<tool_call>\n<function=remember>\n<parameter=content>\nFavorite color is blue\n</parameter>\n</function>\n</tool_call>",
      TOOLS,
    );
    expect(read.calls).toEqual([
      { name: "remember", arguments: { content: "Favorite color is blue" } },
    ]);
  });

  it('turns name: "question" plus a quoted list into an ask_user call', () => {
    const read = readTextToolCalls(SCREENSHOT, TOOLS);
    expect(read.calls).toEqual([
      {
        name: "ask_user",
        arguments: {
          question: "¡Hola, Test! Soy g. ¿Qué quieres que haga?",
          options: [
            "Redactar textos",
            "Buscar información",
            "Organizar mi día",
            "Lo que tú me digas",
          ],
        },
      },
    ]);
    expect(read.text).toBe("");
  });

  it.each([
    ["name: {json}", 'remember: {"content": "Le gusta el té"}'],
    ["name(json)", 'remember({"content": "Le gusta el té"})'],
    ['name("…")', 'remember("Le gusta el té")'],
    ["a JSON object", '{"name": "remember", "arguments": {"content": "Le gusta el té"}}'],
    [
      "JSON arguments as a string",
      '{"name": "remember", "arguments": "{\\"content\\": \\"Le gusta el té\\"}"}',
    ],
    [
      "Qwen <tool_call>",
      '<tool_call>\n{"name": "remember", "arguments": {"content": "Le gusta el té"}}\n</tool_call>',
    ],
  ])("reads %s", (_label, text) => {
    const read = readTextToolCalls(text, TOOLS);
    expect(read.calls).toEqual([{ name: "remember", arguments: { content: "Le gusta el té" } }]);
    expect(read.text).toBe("");
  });

  it("keeps normal text around the tool syntax", () => {
    const read = readTextToolCalls(`Claro, lo guardo.\nremember: "Le gusta el té"\nListo.`, TOOLS);
    expect(read.calls).toHaveLength(1);
    expect(read.text).toBe("Claro, lo guardo.\nListo.");
  });

  it("removes tool syntax it cannot use, and leaves ordinary replies alone", () => {
    const unusable = readTextToolCalls('ask_user: "¿Qué hago?"', TOOLS); // no options
    expect(unusable).toMatchObject({ calls: [], unusable: true, found: true, text: "" });
    const notOffered = readTextToolCalls('ask_user: "¿Qué hago?"\n- "A"\n- "B"', [], ["ask_user"]);
    expect(notOffered).toMatchObject({ calls: [], found: true, text: "" });
    const plain = readTextToolCalls(
      "Hola, ¿en qué te ayudo hoy?\n- Puedo escribir\n- Puedo buscar",
      TOOLS,
    );
    expect(plain).toMatchObject({
      found: false,
      text: "Hola, ¿en qué te ayudo hoy?\n- Puedo escribir\n- Puedo buscar",
    });
    expect(readTextToolCalls('{"answer": 42}', TOOLS)).toMatchObject({ found: false });
  });

  it("reads the offered tools from a chat-completions body", () => {
    expect(
      offeredTools({
        tools: [
          { type: "function", function: { name: "ask_user", parameters: askUser.parameters } },
        ],
      }),
    ).toEqual([askUser]);
  });
});

// ---- A model fixture that streams its reply the way Ollama does ---------------------------

function sse(pieces: string[], finish = "stop"): Response {
  const encoder = new TextEncoder();
  const chunk = (delta: object, finishReason: string | null = null) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "swift", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
  const body = [
    chunk({ role: "assistant", content: "" }),
    ...pieces.map((content) => chunk({ content })),
    chunk({}, finish),
    "data: [DONE]\n\n",
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of body) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** Splits a reply into small pieces, cutting through words and the tool name. */
const pieces = (text: string, size = 3) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

async function read(response: Response) {
  const text = await response.text();
  const chunks = text
    .split("\n\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  const content = chunks.map((c) => c.choices?.[0]?.delta?.content ?? "").join("");
  const calls = chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []);
  const finish = chunks.map((c) => c.choices?.[0]?.finish_reason).filter(Boolean);
  return { content, calls, finish, done: text.includes("data: [DONE]") };
}

describe("the reply stream from a local model", () => {
  it("turns the screenshot's text into a real ask_user call and shows no tool syntax", async () => {
    const out = await read(
      await filterTextToolCalls(sse(pieces(SCREENSHOT)), {
        tools: TOOLS,
        known: ["ask_user", "remember"],
      }),
    );
    expect(out.content).toBe("");
    expect(out.calls).toHaveLength(1);
    expect(out.calls[0].function.name).toBe("ask_user");
    expect(JSON.parse(out.calls[0].function.arguments).options).toHaveLength(4);
    expect(out.finish).toEqual(["tool_calls"]);
    expect(out.done).toBe(true);
  });

  it("streams an ordinary reply through unchanged", async () => {
    const reply = "¡Hola! Claro que sí.\nPuedo ayudarte con eso.";
    const out = await read(
      await filterTextToolCalls(sse(pieces(reply)), { tools: TOOLS, known: ["ask_user"] }),
    );
    expect(out.content).toBe(reply);
    expect(out.calls).toHaveLength(0);
    expect(out.finish).toEqual(["stop"]);
  });

  it("asks again once when the whole reply was unusable tool syntax", async () => {
    const retry = vi.fn(async () => sse(pieces("¿Qué quieres que haga hoy?")));
    const out = await read(
      await filterTextToolCalls(sse(pieces('ask_user: "¿Qué hago?"')), {
        tools: TOOLS,
        known: ["ask_user"],
        retry,
      }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(out.content).toBe("¿Qué quieres que haga hoy?");
    expect(out.content).not.toContain("ask_user");
  });

  it("drops tool syntax it can't call (a slim request with no tools) and keeps the words", async () => {
    const out = await read(
      await filterTextToolCalls(sse(pieces('¡Hola!\nask_user: "¿Qué hago?"\n- "A"\n- "B"')), {
        tools: [],
        known: ["ask_user"],
      }),
    );
    expect(out.content).toBe("¡Hola!\n");
    expect(out.calls).toHaveLength(0);
  });

  it("passes a real tool call through", async () => {
    const encoder = new TextEncoder();
    const call = {
      index: 0,
      id: "x",
      type: "function",
      function: { name: "remember", arguments: '{"content":"a"}' },
    };
    const body = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const response = new Response(
      new ReadableStream({
        start(c) {
          for (const b of body) c.enqueue(encoder.encode(b));
          c.close();
        },
      }),
      {
        headers: { "content-type": "text/event-stream" },
      },
    );
    const out = await read(
      await filterTextToolCalls(response, { tools: TOOLS, known: ["remember"] }),
    );
    expect(out.calls).toEqual([call]);
    expect(out.finish).toEqual(["tool_calls"]);
  });

  it("does the same for a reply that is not streamed", async () => {
    const response = new Response(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: 'remember: "Le gusta el té"' },
            finish_reason: "stop",
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
    const parsed = await (
      await filterTextToolCalls(response, { tools: TOOLS, known: ["remember"] })
    ).json();
    expect(parsed.choices[0].message.content).toBe("");
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("remember");
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
  });
});

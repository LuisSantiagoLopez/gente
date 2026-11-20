// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { codingBody, isCodingTurn, isPlainQuestion, isQuickChat, quickChatBody, userWords } from "./burrow-fast-chat.js";

const time = "\n\n<current_time>\nCurrent date and time: Thursday.\n</current_time>";
const body = (messages: unknown[], effort = "medium") =>
  JSON.stringify({ model: "swift-1.5-27b", reasoning_effort: effort, messages });

describe("Gente fast chat", () => {
  it("drops tagged context when reading the person's words", () => {
    expect(userWords(`hey${time}`)).toBe("hey");
  });

  it("turns thinking off for a short hello", () => {
    const out = quickChatBody(body([{ role: "system", content: "s" }, { role: "user", content: `hey${time}` }]));
    expect(JSON.parse(out!.body).reasoning_effort).toBe("none");
    expect((out!.prefix as { messages: unknown[] }).messages).toHaveLength(1);
  });

  it("keeps thinking for tasks, long messages and tool follow-ups", () => {
    expect(isQuickChat([{ role: "user", content: "create a routine that reminds me to stretch" }])).toBe(false);
    expect(isQuickChat([{ role: "user", content: "x".repeat(200) }])).toBe(false);
    expect(isQuickChat([{ role: "user", content: "hi" }, { role: "tool", content: "ok" }])).toBe(false);
    const out = quickChatBody(body([{ role: "user", content: "please research flights to Tokyo" }]));
    expect(JSON.parse(out!.body).reasoning_effort).toBe("medium");
  });

  it("leaves a model without reasoning effort alone", () => {
    const out = quickChatBody(JSON.stringify({ messages: [{ role: "user", content: "hey" }] }));
    expect(JSON.parse(out!.body).reasoning_effort).toBeUndefined();
  });
});

describe("Gente small talk", () => {
  const system = "You run on Gente.\n\nChief\n\nLong operating manual...\n\n<durable_memory>\n# Chief\nFavorite color is green.";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: "earlier" },
    { role: "assistant", content: null, tool_calls: [{ id: "1" }] },
    { role: "tool", content: "result" },
    { role: "assistant", content: "done" },
    { role: "user", content: `hey${time}` },
  ];

  it("answers greetings with a slim prompt and no tools", async () => {
    const { isSmallTalk } = await import("./burrow-fast-chat.js");
    expect(isSmallTalk([{ role: "user", content: `hey${time}` }])).toBe(true);
    expect(isSmallTalk([{ role: "user", content: "thanks!" }])).toBe(true);
    expect(isSmallTalk([{ role: "user", content: "how are you?" }])).toBe(true);
    expect(isSmallTalk([{ role: "user", content: "hey can you research the best flights to Tokyo next week" }])).toBe(false);
    expect(isSmallTalk([{ role: "user", content: "what's on my calendar" }])).toBe(false);
    const out = quickChatBody(JSON.stringify({ model: "m", reasoning_effort: "medium", tools: [{}], messages }));
    const body = JSON.parse(out!.body);
    expect(body.tools).toBeUndefined();
    expect(body.reasoning_effort).toBe("none");
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[0].content).toContain("Favorite color is green.");
    expect(body.messages[0].content).not.toContain("operating manual");
  });
});

describe("Gente small-talk window", () => {
  it("moves in steps so consecutive turns share their start", () => {
    const turns = (n: number) => [
      { role: "system", content: "s" },
      ...Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
      { role: "user", content: "hey" },
    ];
    const first = (n: number) => JSON.parse(quickChatBody(JSON.stringify({ messages: turns(n) }))!.body).messages[1].content;
    expect(first(10)).toBe("m0");
    expect(first(20)).toBe(first(21));
    expect(first(21)).toBe(first(22));
    expect(JSON.parse(quickChatBody(JSON.stringify({ messages: turns(40) }))!.body).messages.length).toBeLessThanOrEqual(22);
  });
});

describe("Gente quick-reply model", () => {
  it("sends small talk to BURROW_CHAT_MODEL and keeps everything else on the main model", async () => {
    process.env.BURROW_CHAT_MODEL = "swift-1.5-ornith-9b";
    try {
      const hey = quickChatBody(JSON.stringify({ model: "swift-1.5-27b-iq2xxs", messages: [{ role: "user", content: "hey" }] }));
      expect(JSON.parse(hey!.body).model).toBe("swift-1.5-ornith-9b");
      const task = quickChatBody(JSON.stringify({ model: "swift-1.5-27b-iq2xxs", messages: [{ role: "user", content: "research flights to Tokyo" }] }));
      expect(JSON.parse(task!.body).model).toBe("swift-1.5-27b-iq2xxs");
    } finally {
      delete process.env.BURROW_CHAT_MODEL;
    }
  });
});

// Gente routing: coding turns and plain questions after a tool-using turn.

describe("Gente routing", () => {
  const tools = ["shell", "read_file", "write_file", "schedule_create", "request_secret", "web_search"].map((name) => ({
    type: "function",
    function: { name },
  }));
  it("gives a coding turn only the code tools and light thinking, for every request of the turn", () => {
    const ask = [{ role: "system", content: "Platform.\n\nYou are Chief.\n\nLong manual." }, { role: "user", content: "Write a Python function that reverses a string." }];
    expect(isCodingTurn(ask)).toBe(true);
    const body = codingBody({ messages: ask, tools, reasoning_effort: "medium" });
    expect((body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual(["shell", "read_file", "write_file", "web_search"]);
    expect(body.reasoning_effort).toBe("low");
    // A tool follow-up in the same turn keeps the same shape.
    const followUp = [...ask, { role: "assistant", content: "", tool_calls: [{ id: "1" }] }, { role: "tool", content: "ok" }];
    expect(isCodingTurn(followUp)).toBe(true);
  });

  it("treats a short question after a tool-using turn as plain", () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "write a file" },
      { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
      { role: "tool", content: "done" },
      { role: "assistant", content: "Saved." },
      { role: "user", content: "¿Cuál es la capital de Australia?" },
    ];
    expect(isPlainQuestion(messages)).toBe(true);
  });

  it("routes a coding request through quickChatBody with fast chat on", () => {
    const out = quickChatBody(JSON.stringify({ messages: [{ role: "system", content: "a\n\nb\n\nc" }, { role: "user", content: "fix this bug in my JavaScript" }], tools, reasoning_effort: "medium" }));
    expect(JSON.parse(out!.body).tools).toHaveLength(4);
  });
});

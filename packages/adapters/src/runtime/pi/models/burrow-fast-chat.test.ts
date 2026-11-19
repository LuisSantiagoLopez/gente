// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { isQuickChat, quickChatBody, userWords } from "./burrow-fast-chat.js";

const time = "\n\n<current_time>\nCurrent date and time: Thursday.\n</current_time>";
const body = (messages: unknown[], effort = "medium") =>
  JSON.stringify({ model: "swift-1.5-27b", reasoning_effort: effort, messages });

describe("Burrow fast chat", () => {
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

describe("Burrow small talk", () => {
  const system = "You run on Burrow.\n\nChief\n\nLong operating manual...\n\n<durable_memory>\n# Chief\nFavorite color is green.";
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

describe("Burrow small-talk window", () => {
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

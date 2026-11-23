// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { quickChatBody } from "./burrow-fast-chat.js";
import { ASKED_THINKING_EFFORT, asksToThink } from "./burrow-thinking.js";

const body = (text: string, tools = false) =>
  JSON.stringify({
    reasoning_effort: "high",
    messages: [
      { role: "system", content: "You are Chief." },
      { role: "user", content: text },
    ],
    ...(tools ? { tools: [{ type: "function", function: { name: "write_file" } }] } : {}),
  });
const effort = (text: string, tools = false) =>
  JSON.parse(quickChatBody(body(text, tools))!.body).reasoning_effort;

describe("asking the AI to think", () => {
  it("finds the request in English, Spanish and Portuguese", () => {
    expect(asksToThink("explain how rainbows form, think carefully")).toBe(true);
    expect(asksToThink("piensa bien y explícame")).toBe(true);
    expect(asksToThink("explique passo a passo")).toBe(true);
    expect(asksToThink("explain how rainbows form")).toBe(false);
    expect(asksToThink("rethinking")).toBe(false);
  });

  it("keeps thinking on for a short question that asks for it", () => {
    expect(effort("explain how rainbows form, think carefully", true)).toBe(ASKED_THINKING_EFFORT);
  });

  it("still turns thinking off for a short question that does not", () => {
    expect(effort("explain how rainbows form", true)).toBe("none");
  });
});

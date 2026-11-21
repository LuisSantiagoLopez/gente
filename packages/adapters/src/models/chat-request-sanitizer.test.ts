// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import type { WireMessage } from "./chat-request-sanitizer.js";
import {
  ANSWERED_IN_CHAT,
  INTERRUPTED_RESULT,
  sanitizeChatBody,
  sanitizeChatMessages,
  warmablePrefix,
} from "./chat-request-sanitizer.js";

/**
 * The rules a local model server enforces, as observed against it: a trailing assistant
 * message with tool calls is a 400, and a system message after the first is a template error.
 */
function localServerRefuses(messages: readonly WireMessage[]): string | null {
  const last = messages.at(-1);
  if (last?.role === "assistant" && Array.isArray(last.tool_calls) && last.tool_calls.length > 0)
    return "Cannot continue an assistant message that contains tool calls.";
  if (messages.some((m, i) => m.role === "system" && i > 0))
    return "System message must be at the beginning.";
  return null;
}

const call = (id: string, name = "remember") => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});
const system = { role: "system", content: "You are the assistant." };
const ask = { role: "user", content: "remember my favorite color is blue" };

describe("final request check", () => {
  it("resumes a run interrupted mid tool call (the 400 after a restart)", () => {
    // The app closed while the call ran: the stored turn ends with the call and no result.
    const interrupted = [system, ask, { role: "assistant", content: "", tool_calls: [call("c1")] }];
    expect(localServerRefuses(interrupted)).not.toBeNull();
    const resumed = sanitizeChatMessages(interrupted);
    expect(localServerRefuses(resumed)).toBeNull();
    expect(resumed.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: INTERRUPTED_RESULT,
    });
  });

  it("fills only the calls left without a result, in place", () => {
    const fixed = sanitizeChatMessages([
      system,
      ask,
      { role: "assistant", content: "", tool_calls: [call("a"), call("b")] },
      { role: "tool", tool_call_id: "a", content: "ok" },
      { role: "user", content: "hola" },
    ]);
    expect(fixed.map((m) => `${m.role}:${m.tool_call_id ?? ""}`)).toEqual([
      "system:",
      "user:",
      "assistant:",
      "tool:a",
      "tool:b",
      "user:",
    ]);
  });

  it("says a question card was answered in the chat when the person typed after it", () => {
    const fixed = sanitizeChatMessages([
      { role: "assistant", content: "", tool_calls: [call("q", "ask_user")] },
      { role: "user", content: "blue" },
    ]);
    expect(fixed[1]).toMatchObject({ tool_call_id: "q", content: ANSWERED_IN_CHAT });
  });

  it("drops results that answer no call, and duplicates", () => {
    const fixed = sanitizeChatMessages([
      ask,
      { role: "tool", tool_call_id: "ghost", content: "?" },
      { role: "assistant", content: "", tool_calls: [call("a")] },
      { role: "tool", tool_call_id: "a", content: "ok" },
      { role: "tool", tool_call_id: "a", content: "ok again" },
    ]);
    expect(fixed.map((m) => m.content)).toEqual([ask.content, "", "ok"]);
  });

  it("gives a call without an id one, so it can be answered", () => {
    const fixed = sanitizeChatMessages([
      ask,
      { role: "assistant", content: "", tool_calls: [{ function: { name: "remember" } }] },
    ]);
    const id = (fixed[1]!.tool_calls as { id: string }[])[0]!.id;
    expect(id).toBeTruthy();
    expect(fixed[2]).toMatchObject({ role: "tool", tool_call_id: id });
  });

  it("turns a later system message into a note", () => {
    const fixed = sanitizeChatMessages([
      system,
      { role: "system", content: "Also be brief." },
      ask,
      { role: "assistant", content: "", tool_calls: [call("a")] },
      { role: "tool", tool_call_id: "a", content: "ok" },
      { role: "system", content: "The run resumed." },
    ]);
    expect(localServerRefuses(fixed)).toBeNull();
    expect(fixed[0]!.content).toBe("You are the assistant.\n\nAlso be brief.");
    expect(fixed.at(-1)).toEqual({
      role: "user",
      content: "<system_note>\nThe run resumed.\n</system_note>",
    });
  });

  it("leaves a valid request byte for byte as it was", () => {
    const body = JSON.stringify({
      model: "m",
      messages: [
        system,
        ask,
        { role: "assistant", content: "", tool_calls: [call("a")] },
        { role: "tool", tool_call_id: "a", content: "ok" },
      ],
    });
    expect(sanitizeChatBody(body)).toBe(body);
    expect(sanitizeChatBody("not json")).toBe("not json");
  });

  it("warms only a prefix the model server accepts", () => {
    const loop = [
      system,
      ask,
      { role: "assistant", content: "", tool_calls: [call("a")] },
      { role: "tool", tool_call_id: "a", content: "ok" },
      { role: "assistant", content: "", tool_calls: [call("b"), call("c")] },
      { role: "tool", tool_call_id: "b", content: "ok" },
      { role: "tool", tool_call_id: "c", content: "ok" },
    ];
    // Without the newest message the last group is missing a result: warm up to before it.
    expect(warmablePrefix(loop)).toEqual(loop.slice(0, 4));
    // A complete group stays.
    expect(warmablePrefix([...loop, { role: "user", content: "next" }])).toEqual(loop);
    expect(localServerRefuses(warmablePrefix(loop.slice(0, 4)))).toBeNull();
  });
});

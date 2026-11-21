// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The last check on a chat-completions request before it reaches a local model server. Some
// local servers refuse two shapes a resumed run can leave behind:
// - an assistant message with tool calls and no result for each call, as the last message:
//   400 "Cannot continue an assistant message that contains tool calls";
// - a system message after the first message: 500 from the model's chat template.
// Each missing result is filled in, results that answer no call are dropped, and later system
// messages become tagged notes, so the request always has a shape every template accepts.

type WireToolCall = { id?: unknown; function?: { name?: unknown } };
export type WireMessage = {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  [key: string]: unknown;
};

/** The result given for a call the person answered by typing in the chat instead. */
export const ANSWERED_IN_CHAT = "The person answered in the chat instead.";
/** The result given for a call that never finished (the app closed or the run stopped). */
export const INTERRUPTED_RESULT =
  "Interrupted: this step stopped before it finished, so its result is unknown. Run it again if it is still needed.";

function toolCalls(message: WireMessage): WireToolCall[] {
  return message.role === "assistant" && Array.isArray(message.tool_calls)
    ? (message.tool_calls as WireToolCall[])
    : [];
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("\n");
  return "";
}

/** True when the person typed a message after index `from`. */
function personWroteAfter(messages: readonly WireMessage[], from: number): boolean {
  for (let i = from + 1; i < messages.length; i++) if (messages[i]?.role === "user") return true;
  return false;
}

/**
 * Returns messages every local chat template accepts. Leaves an already valid list untouched
 * (the same array), so a request that needs nothing keeps its exact bytes.
 */
export function sanitizeChatMessages(messages: readonly WireMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  let changed = false;
  let leadingSystem = true;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === "system") {
      if (leadingSystem && out.length === 0) {
        out.push(message);
        continue;
      }
      changed = true;
      const note = text(message.content).trim();
      if (!note) continue;
      if (leadingSystem && out.length === 1 && out[0]?.role === "system") {
        // Two system messages at the start: one, in order.
        out[0] = { ...out[0], content: `${text(out[0].content)}\n\n${note}` };
        continue;
      }
      out.push({ role: "user", content: `<system_note>\n${note}\n</system_note>` });
      continue;
    }
    leadingSystem = false;
    if (message.role === "tool") {
      // A result whose call is not right before it answers nothing the model asked for.
      changed = true;
      continue;
    }
    const calls = toolCalls(message);
    if (calls.length === 0) {
      out.push(message);
      continue;
    }
    // Every call needs an id to be answered.
    let fixedCalls = calls;
    if (calls.some((call) => typeof call.id !== "string" || call.id === "")) {
      changed = true;
      fixedCalls = calls.map((call, index) =>
        typeof call.id === "string" && call.id !== ""
          ? call
          : { ...call, id: `call_${i}_${index}` },
      );
      out.push({ ...message, tool_calls: fixedCalls });
    } else {
      out.push(message);
    }
    const ids = new Set(fixedCalls.map((call) => call.id as string));
    const answered = new Set<string>();
    while (messages[i + 1]?.role === "tool") {
      const result = messages[++i]!;
      const id = typeof result.tool_call_id === "string" ? result.tool_call_id : "";
      if (!ids.has(id) || answered.has(id)) {
        changed = true;
        continue;
      }
      answered.add(id);
      out.push(result);
    }
    for (const call of fixedCalls) {
      const id = call.id as string;
      if (answered.has(id)) continue;
      changed = true;
      const asked = call.function?.name === "ask_user" && personWroteAfter(messages, i);
      out.push({
        role: "tool",
        tool_call_id: id,
        content: asked ? ANSWERED_IN_CHAT : INTERRUPTED_RESULT,
      });
    }
  }
  return changed ? out : (messages as WireMessage[]);
}

/** Applies `sanitizeChatMessages` to a request body; returns the same string when nothing changes. */
export function sanitizeChatBody(body: string): string {
  let parsed: { messages?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) return body;
  const messages = parsed.messages as WireMessage[];
  const fixed = sanitizeChatMessages(messages);
  return fixed === messages ? body : JSON.stringify({ ...parsed, messages: fixed });
}

/**
 * The part of a conversation worth sending ahead to warm the model server: everything before the
 * newest message, without a trailing tool call or its results, which only the next real request
 * can complete.
 */
export function warmablePrefix(messages: readonly WireMessage[]): WireMessage[] {
  const prefix = messages.slice(0, -1);
  let start = prefix.length;
  while (start > 0 && prefix[start - 1]?.role === "tool") start--;
  const owner = prefix[start - 1];
  if (owner === undefined || toolCalls(owner).length === 0) return prefix;
  // The last tool call group: keep it only when every call has its result.
  const results = new Set(prefix.slice(start).map((m) => m.tool_call_id));
  const complete = toolCalls(owner).every((call) => results.has(call.id));
  return complete ? prefix : prefix.slice(0, start - 1);
}

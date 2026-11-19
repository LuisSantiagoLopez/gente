// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
//
// Makes plain chat with a local model answer fast:
// - A short message that is not part of a tool loop is answered without thinking
//   (`reasoning_effort: "none"`). Longer requests and tool follow-ups keep their thinking.
// - Every request's stable prefix (all messages but the newest) is saved, so the desktop app can
//   send it to the model server when it opens and the first reply finds its prompt already read.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** On only where Burrow sets `BURROW_FAST_CHAT=on` (its desktop stack), so other setups keep Rakazo behavior. */
const FAST_CHAT_ENV = "BURROW_FAST_CHAT";
/** Longest user message, after dropping tagged context, still treated as plain chat. */
export const QUICK_CHAT_MAX_CHARS = 140;
/** Words that mean "do some work", which keeps thinking on even for a short message. */
const TASK_WORDS =
  /\b(create|make|build|write|research|find|search|schedule|remind|routine|every|daily|weekly|compare|analy[sz]e|plan|fix|debug|code|file|summari[sz]e|draft|email|book|order|calculate|step|steps)\b/i;

type ChatMessage = { role?: string; content?: unknown };

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join(" ");
  return "";
}

/** The person's own words: tagged context blocks such as <current_time> removed. */
export function userWords(content: unknown): string {
  return messageText(content)
    .replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isQuickChat(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return false;
  const words = userWords(last.content);
  return words.length > 0 && words.length <= QUICK_CHAT_MAX_CHARS && !TASK_WORDS.test(words);
}

/** Rewrites one chat-completions body; returns null when nothing should change. */
export function quickChatBody(body: string): { body: string; prefix: unknown } | null {
  let parsed: { messages?: ChatMessage[]; reasoning_effort?: string; stream?: boolean };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.messages)) return null;
  const prefix = { ...parsed, messages: parsed.messages.slice(0, -1) };
  if (parsed.reasoning_effort !== undefined && isQuickChat(parsed.messages)) {
    parsed.reasoning_effort = "none";
  }
  return { body: JSON.stringify(parsed), prefix };
}

let lastSaved = 0;
function savePrefix(prefix: unknown) {
  const dir = process.env.DATA_DIR?.trim();
  if (!dir) return;
  const now = Date.now();
  if (now - lastSaved < 2000) return;
  lastSaved = now;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "burrow-warm.json"), JSON.stringify(prefix));
  } catch {
    // Warming is an optimization; never fail a model call over it.
  }
}

/** Applies both to a request headed for the local model server. */
export function burrowFastChatInit(init: RequestInit | undefined): RequestInit | undefined {
  if (process.env[FAST_CHAT_ENV] !== "on") return init;
  if (!init || typeof init.body !== "string") return init;
  const rewritten = quickChatBody(init.body);
  if (rewritten === null) return init;
  savePrefix(rewritten.prefix);
  return { ...init, body: rewritten.body };
}

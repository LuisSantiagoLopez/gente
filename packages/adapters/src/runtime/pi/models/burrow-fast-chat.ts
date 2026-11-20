// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Makes plain chat with a local model answer fast:
// - A short message that is not part of a tool loop is answered without thinking
//   (`reasoning_effort: "none"`). Longer requests and tool follow-ups keep their thinking.
// - Every request's stable prefix (all messages but the newest) is saved, so the desktop app can
//   send it to the model server when it opens and the first reply finds its prompt already read.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** On only where Gente sets `BURROW_FAST_CHAT=on` (its desktop stack), so other setups keep Rakazo behavior. */
const FAST_CHAT_ENV = "BURROW_FAST_CHAT";
/** Longest user message, after dropping tagged context, still treated as plain chat. */
export const QUICK_CHAT_MAX_CHARS = 140;
/** Words that mean "do some work", which keeps thinking on even for a short message. */
const TASK_WORDS =
  /\b(create|make|build|write|research|find|search|schedule|remind|routine|every|daily|weekly|compare|analy[sz]e|plan|fix|debug|code|file|files|summari[sz]e|draft|email|emails|inbox|book|order|calculate|step|steps|calendar|meeting|remember|forget|memory|open|run|install|telegram|whatsapp|slack|computer|browser|website|site|app|image|picture|photo|video|slides|deck|doc|document|spreadsheet|pdf|buy|pay|send|call|text|message|bot|bots|skill|connect)\b/i;

type ChatMessage = { role?: string; content?: unknown; tool_calls?: unknown };

/** Greetings, thanks and short acknowledgements: answered with a slim prompt and no tools. */
const SMALL_TALK =
  /^(hi+|hey+|hello|yo|sup|hiya|howdy|thanks|thank you|thx|ty|ok|okay|k|cool|nice|great|perfect|awesome|lol|haha+|bye|good (morning|afternoon|evening|night)|gm|gn|how are you( doing)?|how's it going|what'?s up|hola|gracias|buenos d[ií]as|buenas)\b[\s!.?,]*(\w+[\s!.?,]*){0,3}$/i;
/** Text messages of earlier turns kept in a slim small-talk prompt. */
const SMALL_TALK_HISTORY = 12;

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

/** A short question or remark with no task words, sent as a new turn (not inside a tool loop). */
export function isPlainQuestion(messages: readonly ChatMessage[]): boolean {
  // The newest message is the person's, so this is a new turn even if the last one used tools.
  return isQuickChat(messages);
}

/** Words that make a turn about code. */
const CODE_WORDS =
  /```|\b(code|coding|function|functions|script|program|python|javascript|typescript|java|rust|golang|kotlin|swift code|c\+\+|c#|sql|regex|bash|shell script|html|css|react|bug|debug|compile|compiler|stack trace|traceback|refactor|algorithm|unit test|json|yaml)\b/i;
/** The tools a coding turn needs: files, a shell, the web for docs, and a question back. */
const CODE_TOOLS = new Set([
  "shell", "read_file", "write_file", "list_files", "attach_file", "ask_user", "web_search", "web_fetch",
]);

/** The person's newest message in the conversation (the turn this request belongs to). */
function latestUserWords(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return userWords(messages[i]!.content);
  }
  return "";
}

export function isCodingTurn(messages: readonly ChatMessage[]): boolean {
  return CODE_WORDS.test(latestUserWords(messages));
}

/**
 * A coding turn: the bot's identity and memory without the long manual, only the code tools, and
 * light thinking. Every request of the turn (including tool follow-ups) gets the same shape, so the
 * model server keeps its cache across the turn.
 */
export function codingBody(parsed: { messages: ChatMessage[]; tools?: unknown[]; [key: string]: unknown }) {
  const [first, ...rest] = parsed.messages;
  const system =
    first?.role === "system"
      ? [{ role: "system", content: `${slimSystemPrompt(messageText(first.content))}\n\nFor code: answer with the code first, briefly explained. Use the shell and files only when the task needs running or saving something.` }]
      : [];
  const tools = (parsed.tools ?? []).filter((tool) => {
    const name = (tool as { function?: { name?: string } }).function?.name;
    return typeof name === "string" && CODE_TOOLS.has(name);
  });
  return {
    ...parsed,
    messages: [...system, ...(first?.role === "system" ? rest : parsed.messages)],
    tools,
    ...(parsed.reasoning_effort !== undefined ? { reasoning_effort: "low" } : {}),
  };
}

export function isSmallTalk(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return false;
  const words = userWords(last.content);
  return words.length > 0 && words.length <= 40 && SMALL_TALK.test(words);
}

/**
 * The bot's identity and memory without the long operating manual: the first two paragraphs
 * (platform and the bot's own profile) and the durable memory block.
 */
export function slimSystemPrompt(system: string): string {
  const head = system.split(/\n\s*\n/).slice(0, 2).join("\n\n");
  const memoryAt = system.indexOf("<durable_memory>");
  const memory = memoryAt >= 0 ? system.slice(memoryAt) : "";
  return [head, "Reply briefly and naturally, like a friendly coworker.", memory]
    .filter(Boolean)
    .join("\n\n");
}

/** A small-talk request: slim system prompt, recent text turns only, no tools, no thinking. */
export function smallTalkBody(parsed: {
  messages: ChatMessage[];
  [key: string]: unknown;
}): Record<string, unknown> {
  const [first, ...rest] = parsed.messages;
  const system = first?.role === "system" ? [{ role: "system", content: slimSystemPrompt(messageText(first.content)) }] : [];
  const turns = (first?.role === "system" ? rest : parsed.messages).slice(0, -1);
  const text = turns
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.tool_calls)
    .map((m) => ({ role: m.role, content: messageText(m.content) }))
    .filter((m) => m.content.trim() !== "");
  // The window moves in steps, not every turn, so the prompt's start stays the same and the
  // model server reuses what it already read.
  const startAt = Math.max(0, Math.floor((text.length - SMALL_TALK_HISTORY) / 8 + 1) * 8);
  const window = text.length > SMALL_TALK_HISTORY ? text.slice(startAt) : text;
  const { tools: _tools, tool_choice: _choice, parallel_tool_calls: _parallel, ...rest2 } = parsed;
  return {
    ...rest2,
    messages: [...system, ...window, parsed.messages.at(-1)],
    ...(parsed.reasoning_effort !== undefined ? { reasoning_effort: "none" } : {}),
  };
}

/** Rewrites one chat-completions body; returns null when nothing should change. */
export function quickChatBody(
  body: string,
): { body: string; prefix: unknown; chatPrefix?: unknown } | null {
  let parsed: { messages?: ChatMessage[]; reasoning_effort?: string; stream?: boolean };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.messages)) return null;
  const prefix = { ...parsed, messages: parsed.messages.slice(0, -1) };
  // Gente: small talk, and short plain questions that need no tool ("who painted the Mona
  // Lisa?"), skip the 23 tool schemas (~25k characters) and the long manual. They share one small
  // cached prompt, so the first word comes in about a second instead of after ~10k tokens.
  if (isSmallTalk(parsed.messages) || isPlainQuestion(parsed.messages)) {
    const slim = smallTalkBody(parsed as { messages: ChatMessage[] });
    // One assistant, two engines: greetings go to the small fast model when Gente set one.
    const quick = process.env.BURROW_CHAT_MODEL?.trim();
    if (quick) slim.model = quick;
    const messages = slim.messages as unknown[];
    return { body: JSON.stringify(slim), prefix, chatPrefix: { ...slim, messages: messages.slice(0, -1) } };
  }
  if (Array.isArray((parsed as { tools?: unknown[] }).tools) && isCodingTurn(parsed.messages)) {
    return { body: JSON.stringify(codingBody(parsed as { messages: ChatMessage[] })), prefix };
  }
  if (parsed.reasoning_effort !== undefined && isQuickChat(parsed.messages)) {
    parsed.reasoning_effort = "none";
  }
  return { body: JSON.stringify(parsed), prefix };
}

function savePrefix(prefix: unknown, file = "burrow-warm.json") {
  const dir = process.env.DATA_DIR?.trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, file), JSON.stringify(prefix));
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
  if (rewritten.chatPrefix) savePrefix(rewritten.chatPrefix, "burrow-warm-chat.json");
  else savePrefix(rewritten.prefix);
  return { ...init, body: rewritten.body };
}

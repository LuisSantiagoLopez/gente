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
import type { WireMessage } from "../../../models/chat-request-sanitizer.js";
import {
  ANSWERED_IN_CHAT,
  INTERRUPTED_RESULT,
  sanitizeChatMessages,
  warmablePrefix,
} from "../../../models/chat-request-sanitizer.js";
import { HONESTY_RULE, withHonestyRule } from "./gente-honest-actions.js";

/** On only where Gente sets `BURROW_FAST_CHAT=on` (its desktop stack), so other setups keep Rakazo behavior. */
const FAST_CHAT_ENV = "BURROW_FAST_CHAT";
/** Longest user message, after dropping tagged context, still treated as plain chat. */
export const QUICK_CHAT_MAX_CHARS = 140;
/**
 * Words that mean "do some work", which keeps thinking and tools on even for a short message.
 * English, Spanish and Portuguese, since a short task in any of them must still reach the tools.
 */
const TASK_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[
    // English
    "create|make|build|write|research|find|search|look ?up|schedule|remind|routine|every|daily|weekly|compare|analy[sz]e|plan|fix|debug|code|file|files|folder|summari[sz]e|draft|email|emails|inbox|book|order|calculate|step|steps|calendar|meeting|remember|forget|memory|open|run|install|telegram|whatsapp|slack|computer|browser|website|web ?page|webpage|site|page|app|image|picture|photo|video|slides|deck|doc|document|spreadsheet|pdf|buy|pay|send|call|text|message|bot|bots|skill|connect|download|upload|save|delete|translate|generate|design|weather|news|today",
    // Spanish
    "haz|hazme|hacer|haga|hagas|crea|cr[eé]ame|crear|construye|constr[uú]yeme|construir|escribe|escr[ií]beme|escribir|redacta|busca|b[uú]scame|buscar|investiga|investigar|encuentra|manda|m[aá]ndame|mandar|env[ií]a|env[ií]ame|enviar|agenda|agendar|programa|recu[eé]rdame|recuerda|recordar|olvida|abre|abrir|ejecuta|instala|descarga|sube|guarda|borra|elimina|traduce|genera|dise[nñ]a|compara|analiza|resume|res[uú]meme|planea|arregla|calcula|reserva|p[aá]gina|sitio|web|archivo|archivos|carpeta|correo|correos|imagen|imagen(es)?|foto|video|v[ií]deo|documento|hoja|presentaci[oó]n|compra|c[oó]mprame|comprar|paga|pagar|llama|llamar|mensaje|recordatorio|rutina|calendario|reuni[oó]n|clima|noticias|hoy",
    // Portuguese
    "fa[cç]a|fazer|crie|criar|construa|escreva|pesquise|pesquisar|procure|procurar|encontre|mande|envie|enviar|agende|lembre|lembrar|abra|abrir|execute|instale|baixe|salve|apague|traduza|gere|desenhe|compare|analise|resuma|planeje|conserte|calcule|reserve|arquivo|arquivos|pasta|e-?mail|imagem|v[ií]deo|planilha|compre|comprar|pague|pagar|ligue|ligar|mensagem|lembrete|rotina|reuni[aã]o|tempo|not[ií]cias|hoje",
  ].join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

type ChatMessage = { role?: string; content?: unknown; tool_calls?: unknown };

/** Greetings, thanks and short acknowledgements: answered with a slim prompt and no tools. */
const SMALL_TALK =
  /^(hi+|hey+|hello|yo|sup|hiya|howdy|thanks|thank you|thx|ty|ok|okay|k|cool|nice|great|perfect|awesome|lol|haha+|bye|good (morning|afternoon|evening|night)|gm|gn|how are you( doing)?|how's it going|what'?s up|hola|gracias|buenos d[ií]as|buenas( tardes| noches)?|qu[eé] tal|c[oó]mo est[aá]s|oi|ol[aá]|obrigad[oa]|tudo bem|bom dia|boa (tarde|noite))(?![\p{L}\p{N}])[\s!.?,¡¿]*([\p{L}\p{N}']+[\s!.?,¡¿]*){0,3}$/iu;
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
  "shell",
  "read_file",
  "write_file",
  "list_files",
  "attach_file",
  "ask_user",
  "web_search",
  "web_fetch",
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
export function codingBody(parsed: {
  messages: ChatMessage[];
  tools?: unknown[];
  [key: string]: unknown;
}) {
  const [first, ...rest] = parsed.messages;
  const system =
    first?.role === "system"
      ? [
          {
            role: "system",
            content: `${slimSystemPrompt(messageText(first.content))}\n\nFor code: answer with the code first, briefly explained. Use the shell and files only when the task needs running or saving something.`,
          },
        ]
      : [];
  const tools = (parsed.tools ?? []).filter((tool) => {
    const name = (tool as { function?: { name?: string } }).function?.name;
    return typeof name === "string" && CODE_TOOLS.has(name);
  });
  return {
    ...parsed,
    messages: [...system, ...(first?.role === "system" ? rest : parsed.messages)],
    tools,
    // Light thinking at most: a turn sent without thinking stays without it.
    ...(parsed.reasoning_effort !== undefined && parsed.reasoning_effort !== "none"
      ? { reasoning_effort: "low" }
      : {}),
  };
}

/** "ok", "do it", "dale": a go-ahead the reply must not answer with a pretend action. */
const GO_AHEAD =
  /^(ok|okay|yes|yep|sure|do it|go ahead|go|s[ií]|dale|hazlo|adelante|va|sim|pode|fa[cç]a)\b/i;

/** Turns whose reply is checked for claimed actions: tasks, and short go-aheads. */
export function guardsActionClaims(messages: readonly ChatMessage[]): boolean {
  if (!isQuickChat(messages)) return messages.at(-1)?.role === "user";
  return GO_AHEAD.test(latestUserWords(messages));
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
  const head = system
    .split(/\n\s*\n/)
    .slice(0, 2)
    .join("\n\n");
  const memoryAt = system.indexOf("<durable_memory>");
  const memory = memoryAt >= 0 ? system.slice(memoryAt) : "";
  return [head, "Reply briefly and naturally, like a friendly coworker.", HONESTY_RULE, memory]
    .filter(Boolean)
    .join("\n\n");
}

/** A small-talk request: slim system prompt, recent text turns only, no tools, no thinking. */
export function smallTalkBody(parsed: {
  messages: ChatMessage[];
  [key: string]: unknown;
}): Record<string, unknown> {
  const [first, ...rest] = parsed.messages;
  const system =
    first?.role === "system"
      ? [{ role: "system", content: slimSystemPrompt(messageText(first.content)) }]
      : [];
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

/**
 * QA-025: Ollama refuses a request where an assistant message with tool calls is not followed by
 * a result for each call ("Cannot continue an assistant message that contains tool calls"), which
 * happens after a question card is answered in chat or a run is resumed after a restart.
 */
export function repairToolPairs(messages: ChatMessage[]): ChatMessage[] {
  return sanitizeChatMessages(messages as WireMessage[]) as ChatMessage[];
}

// ---- Reply language ----------------------------------------------------------------------
// The bot answers in the language of the person's newest message. Only a message too short to
// tell ("hey", "ok", "vale") borrows the recent conversation's language, so "hey" in a Spanish
// chat gets a Spanish reply, while an English request after Spanish turns gets an English one.

const LANGUAGE_WORDS: Record<"Spanish" | "Portuguese" | "English", RegExp> = {
  Spanish:
    /(?<![\p{L}])(qué|que|el|los|las|y|por|para|con|una|es|está|estás|hola|gracias|quiero|puedes|cómo|dónde|sí|tú|mi|lo|se|también|pero|muy|hacer|dime|ayuda|ayúdame|digas|necesito|tengo|hoy|mañana|bueno|vale|claro|redactar|textos|eso)(?![\p{L}])/giu,
  Portuguese:
    /(?<![\p{L}])(você|não|obrigado|obrigada|olá|oi|quero|pode|é|está|uma|um|com|meu|minha|isso|também|fazer|ajuda|então|tudo|bem|hoje|amanhã|preciso|tenho|legal|beleza|sim|vocês)(?![\p{L}])/giu,
  English:
    /(?<![\p{L}])(the|and|you|to|is|what|how|can|please|my|it|of|for|with|this|that|do|are|want|need|have|today|tomorrow|thanks|yes|sure)(?![\p{L}])/giu,
};

/** Newest messages this short are too short to tell their language; they borrow the chat's. */
const SHORT_MESSAGE_WORDS = 3;

/** Ids of the ask_user calls, whose results are the person's own answers to question cards. */
function askUserCallIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls as { id?: unknown; function?: { name?: unknown } }[]) {
      if (call?.function?.name === "ask_user" && typeof call.id === "string") ids.add(call.id);
    }
  }
  return ids;
}

/**
 * The person's recent words, newest first: typed messages and answers to question cards. Other
 * tool results (a web page, a file) are not the person's words, so they never set the language.
 */
function recentPersonWords(messages: readonly ChatMessage[], limit = 6): string[] {
  const cards = askUserCallIds(messages);
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const message = messages[i]! as ChatMessage & { tool_call_id?: unknown };
    const words = userWords(message.content);
    if (!words) continue;
    if (message.role === "user") out.push(words);
    else if (
      message.role === "tool" &&
      typeof message.tool_call_id === "string" &&
      cards.has(message.tool_call_id) &&
      words.length <= 120 &&
      !/^Waiting for/.test(words) &&
      words !== ANSWERED_IN_CHAT &&
      words !== INTERRUPTED_RESULT
    )
      out.push(words);
  }
  return out;
}

type ReplyLanguage = "Spanish" | "Portuguese" | "English";

/** The language with the most common words in a text (at least `minimum` of them), or null. */
function clearLanguage(text: string, minimum = 2): ReplyLanguage | null {
  if (!text) return null;
  const score = (re: RegExp) => text.match(re)?.length ?? 0;
  const es = score(LANGUAGE_WORDS.Spanish) + (/[¿¡ñ]/.test(text) ? 2 : 0);
  const pt = score(LANGUAGE_WORDS.Portuguese) + (/[ãõç]/.test(text) ? 2 : 0);
  const en = score(LANGUAGE_WORDS.English);
  if (es >= minimum && es > pt && es > en) return "Spanish";
  if (pt >= minimum && pt > es && pt > en) return "Portuguese";
  if (en >= minimum && en > es && en > pt) return "English";
  return null;
}

/**
 * The language to reply in. The newest message wins whenever it leans to a language ("Remember
 * that my favorite color is blue" after a Spanish chat is English). A newest message of a few
 * words with no lean ("hey") takes the recent conversation's language (Spanish or Portuguese
 * only). A longer one with no lean after a Spanish or Portuguese chat gets "latest": reply in that
 * message's own language, never the history's. Null leaves it to the model.
 */
export function conversationLanguage(
  messages: readonly ChatMessage[],
): ReplyLanguage | "latest" | null {
  const words = recentPersonWords(messages);
  const newestWords = words[0] ?? "";
  const recent = clearLanguage(words.slice(1).join(" \n "));
  const newest = clearLanguage(newestWords, 1);
  // English needs saying only when it breaks from a Spanish or Portuguese conversation.
  if (newest === "English")
    return recent === "Spanish" || recent === "Portuguese" ? "English" : null;
  if (newest) return newest;
  const overall = clearLanguage(words.join(" \n "));
  if (!overall || overall === "English") return null;
  return newestWords.split(" ").length <= SHORT_MESSAGE_WORDS ? overall : "latest";
}

const LANGUAGE_TAG = /\n*<reply_language>[\s\S]*?<\/reply_language>/g;

/** The reminder put on the person's newest message, or null when none is needed. */
export function replyLanguageNote(messages: readonly ChatMessage[]): string | null {
  const language = conversationLanguage(messages);
  if (!language) return null;
  const rule =
    language === "latest"
      ? "Reply in the language of this message, even if earlier messages used another language."
      : `Reply in ${language}, the language the person is writing in.`;
  return `<reply_language>${rule}</reply_language>`;
}

/**
 * Adds a one-line language reminder to the person's newest message (inside a tagged block, which
 * the rest of Gente ignores). It goes on that message, not the system prompt, so the prompt's
 * start stays the same and the model server keeps reusing what it already read.
 */
export function withReplyLanguage(messages: ChatMessage[]): ChatMessage[] {
  const note = replyLanguageNote(messages);
  if (!note) return messages;
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      index = i;
      break;
    }
  }
  if (index < 0) return messages;
  const target = messages[index]!;
  let content: unknown = target.content;
  if (typeof content === "string") content = `${content.replace(LANGUAGE_TAG, "")}\n\n${note}`;
  else if (Array.isArray(content)) content = [...content, { type: "text", text: note }];
  else return messages;
  const out = [...messages];
  out[index] = { ...target, content };
  return out;
}

function offersTools(parsed: unknown): boolean {
  const tools = (parsed as { tools?: unknown }).tools;
  return Array.isArray(tools) && tools.length > 0;
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
  parsed.messages = repairToolPairs(parsed.messages);
  parsed.messages = withReplyLanguage(parsed.messages);
  parsed.messages = withHonestyRule(parsed.messages);
  const prefix = { ...parsed, messages: warmablePrefix(parsed.messages as WireMessage[]) };
  // Gente: only clear small talk ("hey", "gracias") skips the tool schemas and the long manual,
  // so the first word comes in about a second. Anything else keeps its tools: a short request in
  // any language ("hazme una página web") must be able to act, not only talk about acting.
  if (isSmallTalk(parsed.messages)) {
    const slim = smallTalkBody(parsed as { messages: ChatMessage[] });
    // One assistant, two engines: greetings go to the small fast model when Gente set one.
    const quick = process.env.BURROW_CHAT_MODEL?.trim();
    if (quick) slim.model = quick;
    const messages = slim.messages as unknown[];
    return {
      body: JSON.stringify(slim),
      prefix,
      chatPrefix: { ...slim, messages: messages.slice(0, -1) },
    };
  }
  if (Array.isArray((parsed as { tools?: unknown[] }).tools) && isCodingTurn(parsed.messages)) {
    return { body: JSON.stringify(codingBody(parsed as { messages: ChatMessage[] })), prefix };
  }
  if (parsed.reasoning_effort !== undefined && isQuickChat(parsed.messages)) {
    parsed.reasoning_effort = "none";
  } else if (parsed.reasoning_effort !== undefined && offersTools(parsed)) {
    // A task with tools thinks briefly, so its steps have a real thought stream to show live.
    parsed.reasoning_effort = "low";
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

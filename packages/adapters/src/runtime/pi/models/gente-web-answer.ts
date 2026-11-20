// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A one-call web answer for a local model. A question that plainly needs the web ("latest",
// "today", "price", "who won", "search for"...) is answered without the usual tool loop
// (model asks to search → search → model asks to fetch → fetch → model answers, 3-5 slow calls):
//   1. search right away (Gente Cloud's search, or DuckDuckGo when that is not available),
//   2. read the top pages in parallel with a 3 s limit each, keeping the passages that match,
//   3. ONE model call with those sources and no tool list, streamed after a short sources line.
// Search results and pages are cached for 24 h, finished answers for 1 h ("refresh" skips it).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bestEffort } from "@rakazo/logging";
import { KeylessHttpWebProvider } from "../../../providers/web/keyless-http/keyless-http-web.js";
import { smallTalkBody, userWords } from "./burrow-fast-chat.js";

type ChatMessage = { role?: string; content?: unknown; tool_calls?: unknown };
export interface WebSource {
  title: string;
  url: string;
  text: string;
}

const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const PAGE_TIMEOUT_MS = 3_000;
const SEARCH_TIMEOUT_MS = 5_000;
/** About 1.5k tokens of page text in total. */
const SOURCES_CHAR_BUDGET = 6_000;
const MAX_SOURCES = 3;

/** Whole words or phrases (any alphabet, accents included), case-insensitive. */
const words = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");

// Fresh facts that live on the web: any of these alone sends a question to the web.
const FACT_TOPICS = words(
  "news|headlines?|weather|forecast|temperature|price|prices|cost of|stocks?|share price|exchange rate|bitcoin|score|scores|who won|winner|election|polls?|release date|box office|trending|traffic|open now|near me|noticias|clima|pron[oó]stico|temperatura|precio|precios|cotizaci[oó]n|tipo de cambio|acciones|marcador|qui[eé]n gan[oó]|elecciones|estreno|tr[aá]fico|abierto ahora|cerca de m[ií]|not[ií]cias|previs[aã]o do tempo|pre[cç]o|pre[cç]os|cota[cç][aã]o|c[aâ]mbio do d[oó]lar|placar|quem ganhou|elei[cç][oõ]es|estreia|tr[aâ]nsito|aberto agora|perto de mim",
);
// Saying "search" (or "look up") always means the web.
const SEARCH_WORDS = words(
  "search (for|the web|online)|look ?up|google it|google|busca(r)? en (internet|la web|google)|b[uú]scalo|investiga en internet|pesquis(e|ar|a) (na internet|no google|na web)|procur(e|ar|a) na internet",
);
// Time words count only next to something that happens in the world.
const TIME_WORDS = words(
  "latest|newest|recent(ly)?|today|tonight|yesterday|this (week|month|year)|right now|currently|hoy|esta noche|ayer|esta semana|ahora mismo|[uú]ltim[oa]s?|hoje|hoje [aà] noite|ontem|esta semana|agora|20[2-9]\\d",
);
const WORLD_EVENTS = words(
  "game|match|plays?|playing|happened|event|concert|movie|show|market|dollar|euro|launch(ed)?|announced?|partido|juega|juegan|pas[oó]|evento|concierto|pel[ií]cula|mercado|d[oó]lar|lanz(a|aron|ó)|anunci[oó]|jogo|joga|jogam|aconteceu|evento|show|filme|mercado|lan[cç](a|ou|aram)|anunciou",
);
// About Gente itself or the person's own things: never the web unless they say "search".
const NOT_WEB = words(
  "what can you do|can you help|help me|who are you|what are you|how are you|remind me|my (calendar|email|emails|inbox|tasks?|day|schedule|files?|notes?|week)|plan my|write|draft|translate|summari[sz]e (this|my)|qu[eé] puedes hacer|puedes ayudarme|me ayudas|ay[uú]dame|qui[eé]n eres|c[oó]mo est[aá]s|recu[eé]rdame|mi (agenda|calendario|correo|d[ií]a|semana|bandeja)|mis (tareas|correos|archivos|notas)|escribe|redacta|traduce|resume (esto|mi)|organiza mi|o que voc[eê] (pode|faz)|pode me ajudar|me ajuda|quem [eé] voc[eê]|como voc[eê] est[aá]|me lembr[ae]|meu (calend[aá]rio|e-?mail|dia)|minha (agenda|semana|caixa)|minhas (tarefas|notas)|escreva|redija|traduza|resuma (isso|meu)",
);
const REFRESH = words("refresh|again|update[sd]?|actualiza");

/** Whether a message needs fresh facts from the web ("web") or the model alone answers it ("model"). */
export function webRoute(text: string): "web" | "model" {
  const words = text.trim();
  if (words.split(/\s+/).length < 2 || words.length > 2400) return "model";
  if (SEARCH_WORDS.test(words)) return "web";
  if (NOT_WEB.test(words)) return "model";
  if (FACT_TOPICS.test(words)) return "web";
  if (TIME_WORDS.test(words) && WORLD_EVENTS.test(words)) return "web";
  return "model";
}

/** True when the newest user message needs fresh facts from the web. */
export function needsWeb(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return false;
  return webRoute(userWords(last.content)) === "web";
}

const normalize = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function cacheDir() {
  const dir = path.join(process.env.DATA_DIR ?? "/tmp", "gente-web-cache");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function cacheGet<T>(kind: string, key: string, maxAgeMs: number): T | null {
  try {
    const file = path.join(
      cacheDir(),
      `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`,
    );
    const saved = JSON.parse(readFileSync(file, "utf8")) as { at: number; value: T };
    return Date.now() - saved.at < maxAgeMs ? saved.value : null;
  } catch {
    return null;
  }
}
function cachePut(kind: string, key: string, value: unknown) {
  try {
    const file = path.join(
      cacheDir(),
      `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`,
    );
    writeFileSync(file, JSON.stringify({ at: Date.now(), value }), { mode: 0o600 });
  } catch {
    // A cache that can't be written is only slower.
  }
}

/** The sentences of a page that share the most words with the question, in page order. */
export function keyPassages(text: string, question: string, budget: number): string {
  const terms = new Set(
    normalize(question)
      .split(" ")
      .filter((w) => w.length > 3),
  );
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 30);
  const scored = sentences.map((s, i) => ({
    i,
    s,
    score: normalize(s)
      .split(" ")
      .filter((w) => terms.has(w)).length,
  }));
  const picked: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + item.s.length > budget) continue;
    picked.push(item);
    used += item.s.length;
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((p) => p.s)
    .join(" ");
}

export interface WebAnswerDeps {
  /** Gente Cloud search through the desktop app (GENTE_SEARCH_URL + GENTE_SEARCH_TOKEN). */
  cloudSearch?: (query: string) => Promise<WebSource[] | null>;
  web?: KeylessHttpWebProvider;
}

function cloudSearchFromEnv(): WebAnswerDeps["cloudSearch"] {
  const url = process.env.GENTE_SEARCH_URL;
  const token = process.env.GENTE_SEARCH_TOKEN;
  if (!url || !token) return undefined;
  return async (query) => {
    const res = await bestEffort(
      "cloud web search",
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      }),
    );
    if (!res?.ok) return null;
    const data = ((await bestEffort("read cloud web search results", res.json())) ?? null) as {
      results?: { title?: string | null; url: string; text?: string | null }[];
    } | null;
    return (data?.results ?? []).map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      text: r.text ?? "",
    }));
  };
}

/** Search, then read the top pages in parallel. Cached for a day. */
export async function gatherSources(
  question: string,
  deps: WebAnswerDeps = {},
): Promise<WebSource[]> {
  const key = normalize(question);
  const cached = cacheGet<WebSource[]>("search", key, DAY_MS);
  if (cached) return cached;
  const web =
    deps.web ??
    new KeylessHttpWebProvider({
      fetchTimeoutMs: PAGE_TIMEOUT_MS,
      searchTimeoutMs: SEARCH_TIMEOUT_MS,
    });
  const context = {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS + PAGE_TIMEOUT_MS + 1_000),
  } as never;
  let hits =
    (await bestEffort(
      "cloud web search",
      (deps.cloudSearch ?? cloudSearchFromEnv())?.(question),
    )) ?? null;
  if (!hits || hits.length === 0) {
    const found =
      (await bestEffort(
        "keyless web search",
        web.search({ query: question, maxResults: 5 }, context),
      )) ?? [];
    hits = found.map((h) => ({ title: h.title, url: h.url, text: h.snippet ?? "" }));
  }
  const top = hits.slice(0, MAX_SOURCES);
  const perPage = Math.floor(SOURCES_CHAR_BUDGET / Math.max(1, top.length));
  const sources = await Promise.all(
    top.map(async (hit) => {
      // Gente Cloud already returns page text; otherwise read the page, 3 s at most.
      let text = hit.text.length > 400 ? hit.text : "";
      if (!text) {
        const page = cacheGet<string>("page", hit.url, DAY_MS);
        if (page !== null) text = page;
        else {
          const fetched = await web
            .fetch({ url: hit.url, maxChars: 40_000 }, context)
            .then((r) => r.text)
            .catch(() => hit.text);
          cachePut("page", hit.url, fetched);
          text = fetched;
        }
      }
      return {
        title: hit.title,
        url: hit.url,
        text: keyPassages(text, question, perPage) || hit.text.slice(0, perPage),
      };
    }),
  );
  const useful = sources.filter((s) => s.text.length > 0);
  if (useful.length > 0) cachePut("search", key, useful);
  return useful;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The line shown before the answer, so the person sees where it comes from right away. */
export function sourcesLine(sources: readonly WebSource[]): string {
  return `${sources.map((s, i) => `[${i + 1}] [${hostOf(s.url)}](${s.url})`).join(" · ")}\n\n`;
}

export type WebAnswerPlan =
  | { kind: "cached"; answer: string }
  | { kind: "ask"; body: string; preface: string; cacheKey: string };

/**
 * Decides whether this model request becomes a one-call web answer, and builds it. Null keeps the
 * request as it was (not a web question, a tool follow-up, or nothing found).
 */
export async function planWebAnswer(
  rawBody: string,
  deps: WebAnswerDeps = {},
): Promise<WebAnswerPlan | null> {
  let parsed: { messages?: ChatMessage[]; tools?: unknown[]; [key: string]: unknown };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const messages = parsed.messages ?? [];
  if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) return null;
  if (!needsWeb(messages)) return null;
  const question = userWords(messages.at(-1)!.content);
  const cacheKey = normalize(question);
  if (!REFRESH.test(question)) {
    const answer = cacheGet<string>("answer", cacheKey, HOUR_MS);
    if (answer) return { kind: "cached", answer };
  }
  const sources = await gatherSources(question, deps);
  if (sources.length === 0) return null;
  const block = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`).join("\n\n");
  const last = messages.at(-1)!;
  const content = `${typeof last.content === "string" ? last.content : userWords(last.content)}\n\n<web_results>\nFresh web results for this message. Answer from them in 2 or 3 short sentences, cite them like [1], and say plainly if they don't answer it. Don't call tools.\n\n${block}\n</web_results>`;
  // The same slim, cached prompt as small talk (identity, memory, recent text turns, no tools),
  // so the model only reads the sources and the question.
  const slim = smallTalkBody({ ...parsed, messages } as { messages: ChatMessage[] });
  const slimMessages = slim.messages as ChatMessage[];
  return {
    kind: "ask",
    cacheKey,
    preface: sourcesLine(sources),
    body: JSON.stringify({
      ...slim,
      messages: [...slimMessages.slice(0, -1), { ...last, content }],
      reasoning_effort: "none",
      // Measured: reading the sources takes 1-2 s; most of a 15-30 s answer was the model writing
      // long replies at ~10 tokens/s. Short answers keep it quick.
      max_tokens: 180,
      max_completion_tokens: 180,
    }),
  };
}

const sse = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "gente-web", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "gente", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** A cached answer, replayed as the model server would stream it. */
export function cachedAnswerResponse(answer: string): Response {
  const body = `${sse({ role: "assistant", content: answer })}${sse({}, "stop")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * Streams the sources line first, then the model's own stream unchanged; remembers the finished
 * answer for an hour.
 */
export function withPreface(response: Response, preface: string, cacheKey: string): Response {
  if (!response.ok || !response.body) return response;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let answer = preface;
  let pending = "";
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ role: "assistant", content: preface })));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (answer.length > preface.length + 20) cachePut("answer", cacheKey, answer);
        controller.close();
        return;
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") answer += delta;
        } catch {
          // Not a JSON line; passed through untouched below.
        }
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
  return new Response(stream, { status: response.status, headers: response.headers });
}

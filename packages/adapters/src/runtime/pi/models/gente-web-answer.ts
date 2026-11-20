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
import { KeylessHttpWebProvider } from "../../../providers/web/keyless-http/keyless-http-web.js";
import { userWords } from "./burrow-fast-chat.js";

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

const WEB_WORDS =
  /\b(latest|newest|recent(ly)?|today|tonight|yesterday|this (week|month|year)|right now|currently|current|news|headlines?|price|prices|cost of|stock|weather|forecast|score|scores|who won|winner|results?|election|released?|release date|schedule|open now|near me|trending|search (for|the web)|look ?up|google|busca(r)?|noticias|hoy|precio|clima|últim[oa]s?)\b|\b20[2-9]\d\b/i;
const REFRESH = /\b(refresh|again|update[sd]?|actualiza)\b/i;

/** True when the newest user message plainly asks for something that lives on the web. */
export function needsWeb(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return false;
  const words = userWords(last.content);
  return words.length >= 6 && words.length <= 400 && WEB_WORDS.test(words);
}

const normalize = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

function cacheDir() {
  const dir = path.join(process.env.DATA_DIR ?? "/tmp", "gente-web-cache");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function cacheGet<T>(kind: string, key: string, maxAgeMs: number): T | null {
  try {
    const file = path.join(cacheDir(), `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { at: number; value: T };
    return Date.now() - saved.at < maxAgeMs ? saved.value : null;
  } catch {
    return null;
  }
}
function cachePut(kind: string, key: string, value: unknown) {
  try {
    const file = path.join(cacheDir(), `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
    writeFileSync(file, JSON.stringify({ at: Date.now(), value }), { mode: 0o600 });
  } catch {
    // A cache that can't be written is only slower.
  }
}

/** The sentences of a page that share the most words with the question, in page order. */
export function keyPassages(text: string, question: string, budget: number): string {
  const terms = new Set(normalize(question).split(" ").filter((w) => w.length > 3));
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  const scored = sentences.map((s, i) => ({
    i,
    s,
    score: normalize(s).split(" ").filter((w) => terms.has(w)).length,
  }));
  const picked: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + item.s.length > budget) continue;
    picked.push(item);
    used += item.s.length;
  }
  return picked.sort((a, b) => a.i - b.i).map((p) => p.s).join(" ");
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
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      results?: { title?: string | null; url: string; text?: string | null }[];
    } | null;
    return (data?.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, text: r.text ?? "" }));
  };
}

/** Search, then read the top pages in parallel. Cached for a day. */
export async function gatherSources(question: string, deps: WebAnswerDeps = {}): Promise<WebSource[]> {
  const key = normalize(question);
  const cached = cacheGet<WebSource[]>("search", key, DAY_MS);
  if (cached) return cached;
  const web = deps.web ?? new KeylessHttpWebProvider({ fetchTimeoutMs: PAGE_TIMEOUT_MS, searchTimeoutMs: SEARCH_TIMEOUT_MS });
  const context = { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS + PAGE_TIMEOUT_MS + 1_000) } as never;
  let hits = (await (deps.cloudSearch ?? cloudSearchFromEnv())?.(question).catch(() => null)) ?? null;
  if (!hits || hits.length === 0) {
    const found = await web.search({ query: question, maxResults: 5 }, context).catch(() => []);
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
      return { title: hit.title, url: hit.url, text: keyPassages(text, question, perPage) || hit.text.slice(0, perPage) };
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
export async function planWebAnswer(rawBody: string, deps: WebAnswerDeps = {}): Promise<WebAnswerPlan | null> {
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
  const block = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`)
    .join("\n\n");
  const last = messages.at(-1)!;
  const content = `${typeof last.content === "string" ? last.content : userWords(last.content)}\n\n<web_results>\nFresh web results for this message. Answer from them in a few short sentences, cite them like [1], and say plainly if they don't answer it. Don't call tools.\n\n${block}\n</web_results>`;
  const { tools: _tools, tool_choice: _choice, parallel_tool_calls: _parallel, ...rest } = parsed;
  return {
    kind: "ask",
    cacheKey,
    preface: sourcesLine(sources),
    body: JSON.stringify({
      ...rest,
      messages: [...messages.slice(0, -1), { ...last, content }],
      reasoning_effort: "none",
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

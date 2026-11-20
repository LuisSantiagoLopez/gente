// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The support chat's brain: find the best help sections (instant, local), then stream an answer
// from Gente's own local model. If the model server is down, the person still gets the best help
// section and a one-tap fix right away, so support works even when Gente itself does not.
import type { FixId } from "./fixes.js";
import { FIX_IDS, isFixId } from "./fixes.js";
import type { HealthReport } from "./health.js";
import type { HelpIndex, HelpLang, HelpSection } from "./help-docs.js";
import type { SupportTurn } from "./support.prompt.js";
import { buildSupportMessages, supportRules } from "./support.prompt.js";

export type SupportSource = { title: string; heading: string; slug: string; anchor: string };

export type SupportEvent =
  | { type: "sources"; sources: SupportSource[] }
  /** The best help section, shown at once while the local model writes its answer. */
  | { type: "preview"; heading: string; text: string }
  | { type: "token"; text: string }
  | { type: "done"; text: string; fix: FixId | null; human: boolean; fromModel: boolean };

export type AssistantDeps = {
  index: HelpIndex;
  ollamaUrl: string;
  modelAlias: () => Promise<string | null>;
  health: () => HealthReport | null;
  version: string;
  platform: string;
  fetch?: typeof fetch;
};

/** Reads `[fix:id]` and `[human]` tags from an answer and returns the text without them. */
export function parseAnswer(raw: string): { text: string; fix: FixId | null; human: boolean } {
  let fix: FixId | null = null;
  const human = /\[human\]/i.test(raw);
  for (const match of raw.matchAll(/\[fix:([a-z-]+)\]/gi)) {
    const id = match[1]?.toLowerCase();
    if (fix === null && isFixId(id)) fix = id;
  }
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\[fix:[a-z-]+\]|\[human\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, fix, human };
}

/** A fix a failing health check names, when the question is about something that is broken. */
function fixFromHealth(health: HealthReport | null): FixId | null {
  return health?.checks.find((c) => c.status === "fail" && c.fix)?.fix ?? null;
}

function fallbackAnswer(sections: readonly HelpSection[], lang: HelpLang): string {
  const best = sections[0];
  const intro = {
    en: "Here is what the help says:",
    es: "Esto dice la ayuda:",
    pt: "Veja o que diz a ajuda:",
  }[lang];
  const none = {
    en: "I couldn't find this in the help. You can send it to a person below.",
    es: "No encontré esto en la ayuda. Puedes enviarlo a una persona abajo.",
    pt: "Não encontrei isso na ajuda. Você pode enviar para uma pessoa abaixo.",
  }[lang];
  if (!best) return none;
  return `${intro}\n\n**${best.heading}**\n\n${best.text.slice(0, 900)}`;
}

export async function* askSupport(
  deps: AssistantDeps,
  question: string,
  history: readonly SupportTurn[],
  lang: HelpLang,
): AsyncGenerator<SupportEvent> {
  const fetcher = deps.fetch ?? fetch;
  const hits = deps.index.search(`${history.at(-2)?.content ?? ""} ${question}`, lang, 2);
  const sections = hits.map((h) => h.section);
  yield {
    type: "sources",
    sources: sections
      .slice(0, 3)
      .map((s) => ({ title: s.articleTitle, heading: s.heading, slug: s.slug, anchor: s.anchor })),
  };
  const health = deps.health();
  const alias = await deps.modelAlias().catch(() => null);
  if (alias !== null && sections[0])
    yield { type: "preview", heading: sections[0].heading, text: sections[0].text.slice(0, 600) };
  if (alias === null) {
    yield {
      type: "done",
      text: fallbackAnswer(sections, lang),
      fix: fixFromHealth(health),
      human: sections.length === 0,
      fromModel: false,
    };
    return;
  }
  const messages = buildSupportMessages({
    question,
    history,
    sections,
    health,
    version: deps.version,
    platform: deps.platform,
    lang,
    fixes: FIX_IDS,
  });
  let raw = "";
  try {
    const res = await fetcher(`${deps.ollamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: alias,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: 260,
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || res.body === null) throw new Error(`model answered ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] })
          .choices?.[0]?.delta?.content;
        if (delta) {
          raw += delta;
          yield { type: "token", text: delta };
        }
      }
    }
  } catch {
    if (raw.trim() === "") {
      yield {
        type: "done",
        text: fallbackAnswer(sections, lang),
        fix: fixFromHealth(health),
        human: false,
        fromModel: false,
      };
      return;
    }
  }
  const parsed = parseAnswer(raw);
  yield { type: "done", ...parsed, fromModel: true };
}

/** "Talk to a person" shows only when support is stuck. */
export function shouldOfferHuman(state: {
  modelAskedForHuman: boolean;
  unhelpfulAnswers: number;
  failedFixes: number;
  noHelpFound: boolean;
}): boolean {
  return (
    state.modelAskedForHuman ||
    state.unhelpfulAnswers >= 2 ||
    state.failedFixes >= 1 ||
    state.noHelpFound
  );
}

/**
 * Has the model server read the fixed support instructions ahead of time, so the first question
 * only waits for its own short context. Called once the model is up; harmless if it fails.
 */
export async function prewarmSupport(
  ollamaUrl: string,
  alias: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetcher(`${ollamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: alias,
        // A user turn is needed for the server to read the system message at all.
        messages: [
          { role: "system", content: supportRules(FIX_IDS) },
          { role: "user", content: "hi" },
        ],
        stream: false,
        max_tokens: 1,
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}

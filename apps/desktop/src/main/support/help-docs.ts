// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente's help articles (docs/gente/help/<lang>/*.md) and a small local search over them. The
// support chat hands the best sections to the local model, so its answers come from the docs.
// Plain keyword scoring (BM25): it runs in a millisecond and needs no second model.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const HELP_LANGS = ["en", "es", "pt"] as const;
export type HelpLang = (typeof HELP_LANGS)[number];

export type HelpArticle = { lang: HelpLang; slug: string; title: string; markdown: string };
export type HelpSection = {
  lang: HelpLang;
  slug: string;
  articleTitle: string;
  heading: string;
  anchor: string;
  text: string;
};

/** The help language for an app locale: Spanish and Portuguese of any region, else English. */
export function helpLang(locale: string): HelpLang {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return base === "es" ? "es" : base === "pt" ? "pt" : "en";
}

export function anchorFor(heading: string): string {
  return heading
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function loadHelpArticles(dir: string): Promise<HelpArticle[]> {
  const articles: HelpArticle[] = [];
  for (const lang of HELP_LANGS) {
    let files: string[];
    try {
      files = (await readdir(path.join(dir, lang))).filter((f) => f.endsWith(".md")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const markdown = await readFile(path.join(dir, lang, file), "utf8");
      const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? file;
      articles.push({
        lang,
        slug: file.replace(/^\d+-/, "").replace(/\.md$/, ""),
        title,
        markdown,
      });
    }
  }
  return articles;
}

/** Splits each article at its `##` headings. The intro before the first one is its own section. */
export function sectionsOf(article: HelpArticle): HelpSection[] {
  const out: HelpSection[] = [];
  let heading = article.title;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text !== "")
      out.push({
        lang: article.lang,
        slug: article.slug,
        articleTitle: article.title,
        heading,
        anchor: anchorFor(heading),
        text,
      });
    lines = [];
  };
  for (const line of article.markdown.split("\n")) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[1]?.trim() ?? heading;
    } else if (!/^#\s/.test(line)) {
      lines.push(line);
    }
  }
  flush();
  return out;
}

const STOP = new Set(
  (
    "a an the and or but to of in on for is are was it this that i my me you your how do does what why when can " +
    "el la los las un una y o de del en por para es son que como mi me tu su se lo al con no " +
    "o a os as um uma e de do da dos das em no na por para que como meu minha seu sua se com nao"
  ).split(" "),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => (word.length > 4 ? word.replace(/(es|s)$/, "") : word));
}

export class HelpIndex {
  private readonly docs: { section: HelpSection; terms: Map<string, number>; length: number }[] =
    [];
  private readonly df = new Map<string, number>();
  private avgLength = 1;

  constructor(readonly sections: readonly HelpSection[]) {
    for (const section of sections) {
      // The heading counts three times: a match there is a strong sign.
      const words = [
        ...tokens(section.heading),
        ...tokens(section.heading),
        ...tokens(section.heading),
        ...tokens(section.text),
      ];
      const terms = new Map<string, number>();
      for (const word of words) terms.set(word, (terms.get(word) ?? 0) + 1);
      for (const word of terms.keys()) this.df.set(word, (this.df.get(word) ?? 0) + 1);
      this.docs.push({ section, terms, length: words.length });
    }
    this.avgLength =
      this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, this.docs.length);
  }

  static fromArticles(articles: readonly HelpArticle[]) {
    return new HelpIndex(articles.flatMap(sectionsOf));
  }

  /** The best sections for a question, in one language (English when that language has none). */
  search(query: string, lang: HelpLang, limit = 4): { section: HelpSection; score: number }[] {
    const words = tokens(query);
    const pool = this.docs.some((d) => d.section.lang === lang) ? lang : "en";
    const n = this.docs.filter((d) => d.section.lang === pool).length;
    const k1 = 1.4;
    const b = 0.75;
    return this.docs
      .filter((d) => d.section.lang === pool)
      .map((d) => {
        let score = 0;
        for (const word of words) {
          const tf = d.terms.get(word) ?? 0;
          if (tf === 0) continue;
          const df = this.df.get(word) ?? 1;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / this.avgLength));
        }
        return { section: d.section, score };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit);
  }
}

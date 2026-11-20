// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A small, safe Markdown renderer for Gente's help articles, shared by the app and the website.
// It handles the subset the articles use (headings, paragraphs, lists, tables, quotes, code,
// bold, italic, links) and escapes everything else, so no article can inject HTML or script.

export type RenderOptions = {
  /** Turns an article link like `troubleshooting#slow` into an href. */
  articleHref?: (slug: string, anchor: string) => string;
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inline(text: string, options: RenderOptions): string {
  const codes: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
      const raw = href.replace(/&amp;/g, "&");
      if (/^(https:|mailto:)/i.test(raw))
        return `<a href="${escapeHtml(raw)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      const internal = /^([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(raw);
      if (internal) {
        const slug = internal[1] ?? "";
        const anchor = internal[2] ?? "";
        const target =
          options.articleHref?.(slug, anchor) ?? `#${slug}${anchor ? `-${anchor}` : ""}`;
        return `<a href="${escapeHtml(target)}" data-article="${slug}" data-anchor="${anchor}">${label}</a>`;
      }
      if (/^#[a-z0-9-]+$/.test(raw)) return `<a href="${raw}">${label}</a>`;
      // Anything else (javascript:, data:, http:) renders as plain text.
      return label;
    });
  return out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codes[Number(i)] ?? "");
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  const isBlockStart = (line: string) =>
    /^(#{1,4}\s|[-*]\s|\d+\.\s|>\s?|```|\|)/.test(line) || line.trim() === "";
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) code.push(lines[i++] ?? "");
      i++;
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      html.push(`<h${level} id="${slugify(text)}">${inline(text, options)}</h${level}>`);
      i++;
      continue;
    }
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/ : /^[-*]\s/).test(lines[i] ?? "")) {
        let item = (lines[i] ?? "").replace(/^([-*]|\d+\.)\s+/, "");
        i++;
        // Indented continuation lines belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? ""))
          item += ` ${(lines[i++] ?? "").trim()}`;
        items.push(`<li>${inline(item, options)}</li>`);
      }
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">"))
        quote.push((lines[i++] ?? "").replace(/^>\s?/, ""));
      html.push(`<blockquote><p>${inline(quote.join(" "), options)}</p></blockquote>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) {
        const cells = (lines[i++] ?? "")
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      html.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c, options)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, options)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i] ?? "")) paragraph.push(lines[i++] ?? "");
    if (paragraph.length === 0) paragraph.push(lines[i++] ?? "");
    html.push(`<p>${inline(paragraph.join(" "), options)}</p>`);
  }
  return html.join("\n");
}

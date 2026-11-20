// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Renders Gente's help articles (docs/gente/help) as a static website: one page per article and
// language, a search over every section, and the support form. The app renders the same files
// with the same renderer, so the site and the app never disagree.
//
//   pnpm exec tsx scripts/gente-help-site.ts <outDir> [--base /help]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HelpLang } from "../apps/desktop/src/main/support/help-docs.js";
import {
  HELP_LANGS,
  loadHelpArticles,
  sectionsOf,
} from "../apps/desktop/src/main/support/help-docs.js";
import { escapeHtml, renderMarkdown } from "../apps/desktop/src/main/support/markdown.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "apps/desktop/build/help-site"));
const baseAt = process.argv.indexOf("--base");
const base = (baseAt > 0 ? process.argv[baseAt + 1] : "/help")?.replace(/\/$/, "") ?? "/help";

const UI: Record<HelpLang, Record<string, string>> = {
  en: {
    name: "English",
    title: "Gente Help",
    search: "Search help",
    contact: "Still stuck? Write to us",
    email: "Your email",
    message: "What's going on?",
    send: "Send",
    sent: "Sent. We'll reply to your email soon.",
    bad: "Add your email and a short message.",
    all: "All articles",
    lead: "Answers in plain words. In the app, open Help → Gente Support to ask and fix things in one tap.",
  },
  es: {
    name: "Español",
    title: "Ayuda de Gente",
    search: "Buscar en la ayuda",
    contact: "¿Sigues con el problema? Escríbenos",
    email: "Tu correo",
    message: "¿Qué pasa?",
    send: "Enviar",
    sent: "Enviado. Te responderemos por correo pronto.",
    bad: "Escribe tu correo y un mensaje corto.",
    all: "Todos los artículos",
    lead: "Respuestas en palabras simples. En la app, abre Ayuda → Soporte de Gente para preguntar y arreglar cosas con un toque.",
  },
  pt: {
    name: "Português",
    title: "Ajuda do Gente",
    search: "Buscar na ajuda",
    contact: "Ainda com problema? Fale com a gente",
    email: "Seu e-mail",
    message: "O que está acontecendo?",
    send: "Enviar",
    sent: "Enviado. Vamos responder no seu e-mail em breve.",
    bad: "Coloque seu e-mail e uma mensagem curta.",
    all: "Todos os artigos",
    lead: "Respostas em palavras simples. No app, abra Ajuda → Suporte do Gente para perguntar e resolver com um toque.",
  },
};

const CSS = `:root{--bg:#fbf6ec;--card:#fff;--ink:#1c1710;--muted:#6b6255;--line:#eadfcb;--accent:#c8752a;--accent-ink:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14110d;--card:#1e1913;--ink:#f7f0e4;--muted:#a89d8c;--line:#2f271e;--accent:#e39a4f;--accent-ink:#14110d}}
:root[data-theme="dark"]{--bg:#14110d;--card:#1e1913;--ink:#f7f0e4;--muted:#a89d8c;--line:#2f271e;--accent:#e39a4f;--accent-ink:#14110d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 ui-rounded,"SF Pro Rounded",-apple-system,"Segoe UI",system-ui,sans-serif;padding:0 16px 80px}
.w{max-width:760px;margin:0 auto}header{display:flex;align-items:center;gap:12px;padding:22px 0 8px;flex-wrap:wrap}
.mark{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f2b56b,var(--accent) 70%)}
header a.home{font-weight:700;text-decoration:none;color:inherit;font-size:18px}nav.langs{margin-left:auto;display:flex;gap:6px}
nav.langs a{font-size:14px;color:var(--muted);text-decoration:none;padding:4px 10px;border-radius:999px;border:1px solid var(--line)}nav.langs a[aria-current]{color:var(--ink);background:var(--card)}
h1{font-size:clamp(32px,6vw,44px);line-height:1.1;margin:28px 0 10px;letter-spacing:-.02em}h2{font-size:22px;margin:34px 0 8px;padding-top:14px;border-top:1px solid var(--line)}h3{font-size:18px;margin:20px 0 6px}
p,li{color:var(--ink)}.lead{color:var(--muted);font-size:18px}a{color:var(--accent)}code{background:var(--card);border:1px solid var(--line);padding:1px 6px;border-radius:6px;font-size:.9em}
table{border-collapse:collapse;width:100%;margin:12px 0;display:block;overflow-x:auto}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
blockquote{margin:14px 0;padding:10px 14px;background:var(--card);border-left:3px solid var(--accent);border-radius:0 12px 12px 0}
.search{width:100%;font:inherit;padding:12px 16px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);margin:16px 0 8px}
.cards{list-style:none;padding:0;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.cards a{display:block;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line);text-decoration:none;color:var(--ink);height:100%}
.cards a:hover{border-color:var(--accent)}.cards small{display:block;color:var(--muted);font-size:14px;margin-top:4px}
#results{list-style:none;padding:0;margin:0 0 12px}#results a{display:block;padding:10px 12px;border-radius:12px;text-decoration:none;color:var(--ink)}#results a:hover{background:var(--card)}#results small{color:var(--muted);display:block;font-size:14px}
.back{display:inline-block;margin-top:22px;color:var(--muted);text-decoration:none;font-size:15px}
form{display:grid;gap:12px;margin-top:14px}label{display:grid;gap:6px;font-weight:600;font-size:15px}input,textarea{font:inherit;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button{justify-self:start;font:inherit;font-weight:700;border:0;border-radius:999px;padding:11px 22px;background:var(--accent);color:var(--accent-ink);cursor:pointer}.hp{position:absolute;left:-9999px}#st{color:var(--muted);min-height:1.4em;margin:0}`;

const SEARCH_JS = `(()=>{const q=document.getElementById("q"),r=document.getElementById("results");if(!q)return;let idx=null;
const norm=s=>s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");
q.addEventListener("input",async()=>{idx??=await (await fetch(q.dataset.index)).json();const words=norm(q.value).split(/\\s+/).filter(w=>w.length>1);
if(!words.length){r.replaceChildren();return}
const hits=idx.map(s=>({s,score:words.reduce((n,w)=>n+(norm(s.h).includes(w)?3:0)+(norm(s.t).includes(w)?1:0),0)})).filter(h=>h.score>0).sort((a,b)=>b.score-a.score).slice(0,6);
r.replaceChildren(...hits.map(({s})=>{const li=document.createElement("li"),a=document.createElement("a");a.href=s.u;const b=document.createElement("strong");b.textContent=s.h;const sm=document.createElement("small");sm.textContent=s.a;a.append(b,sm);li.append(a);return li}))})})();
(()=>{const f=document.getElementById("sf"),st=document.getElementById("st");if(!f)return;f.addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(d.email||"")||(d.message||"").trim().length<5){st.textContent=f.dataset.bad;return}
st.textContent="…";try{const res=await fetch("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...d,message:"[Gente help site] "+d.message})});const j=await res.json();if(!res.ok)throw new Error(j.error);f.reset();st.textContent=f.dataset.sent}catch(err){st.textContent=err.message||"…"}})})();`;

function page(lang: HelpLang, title: string, body: string, alternates: Record<HelpLang, string>) {
  const ui = UI[lang];
  const langs = HELP_LANGS.map(
    (l) =>
      `<a href="${alternates[l]}" hreflang="${l}"${l === lang ? ' aria-current="page"' : ""}>${UI[l].name}</a>`,
  ).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(ui.lead)}">
${HELP_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${alternates[l]}">`).join("")}
<link rel="stylesheet" href="${base}/help.css"></head><body><div class="w">
<header><span class="mark" aria-hidden="true"></span><a class="home" href="${base}/${lang}/">${ui.title}</a><nav class="langs">${langs}</nav></header>
<main>${body}</main>
<section><h2>${ui.contact}</h2><form id="sf" data-sent="${escapeHtml(ui.sent)}" data-bad="${escapeHtml(ui.bad)}">
<label>${ui.email}<input name="email" type="email" required autocomplete="email"></label>
<label>${ui.message}<textarea name="message" rows="4" required></textarea></label>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit">${ui.send}</button><p id="st" role="status" aria-live="polite"></p></form></section>
</div><script src="${base}/help.js"></script></body></html>`;
}

const articles = await loadHelpArticles(path.join(ROOT, "docs/gente/help"));
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "help.css"), CSS);
await writeFile(path.join(out, "help.js"), SEARCH_JS);
const href = (lang: HelpLang, slug: string, anchor = "") =>
  `${base}/${lang}/${slug}.html${anchor ? `#${anchor}` : ""}`;
let pages = 0;
for (const lang of HELP_LANGS) {
  const mine = articles.filter((a) => a.lang === lang);
  const ui = UI[lang];
  await mkdir(path.join(out, lang), { recursive: true });
  const index = mine.flatMap((a) =>
    sectionsOf(a).map((s) => ({
      h: s.heading,
      a: a.title,
      t: s.text.slice(0, 400),
      u: href(lang, a.slug, s.anchor),
    })),
  );
  await writeFile(path.join(out, lang, "search.json"), JSON.stringify(index));
  const cards = mine
    .map((a) => {
      const first = /\n\n([^#\n][^\n]+)/.exec(a.markdown)?.[1] ?? "";
      return `<li><a href="${href(lang, a.slug)}"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(first.replace(/\*\*/g, "").slice(0, 110))}</small></a></li>`;
    })
    .join("");
  const indexAlternates = Object.fromEntries(HELP_LANGS.map((l) => [l, `${base}/${l}/`])) as Record<
    HelpLang,
    string
  >;
  await writeFile(
    path.join(out, lang, "index.html"),
    page(
      lang,
      ui.title,
      `<h1>${ui.title}</h1><p class="lead">${ui.lead}</p><input id="q" class="search" type="search" placeholder="${ui.search}" data-index="${base}/${lang}/search.json" aria-label="${ui.search}"><ul id="results"></ul><ul class="cards">${cards}</ul>`,
      indexAlternates,
    ),
  );
  pages++;
  for (const article of mine) {
    const alternates = Object.fromEntries(
      HELP_LANGS.map((l) => [l, href(l, article.slug)]),
    ) as Record<HelpLang, string>;
    const html = renderMarkdown(article.markdown, {
      articleHref: (slug, anchor) => href(lang, slug, anchor),
    });
    await writeFile(
      path.join(out, lang, `${article.slug}.html`),
      page(
        lang,
        `${article.title} · ${ui.title}`,
        `${html}<a class="back" href="${base}/${lang}/">← ${ui.all}</a>`,
        alternates,
      ),
    );
    pages++;
  }
}
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Gente Help</title><script>const l=(navigator.language||"en").slice(0,2);location.replace("${base}/"+(l==="es"||l==="pt"?l:"en")+"/")</script><a href="${base}/en/">Gente Help</a>`,
);
console.log(`${pages} pages in ${out}`);

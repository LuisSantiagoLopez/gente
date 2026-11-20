// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
// Gente Support window. Answers come from the local model over Gente's help articles; every
// fix is one tap; a person is offered only when support is stuck.
(() => {
  const api = window.genteSupport;
  const $ = (id) => document.getElementById(id);

  const STRINGS = {
    en: {
      title: "Support",
      checking: "Checking…",
      allGood: "All good",
      needsLook: "1 thing needs a look",
      needsLookMany: "{n} things need a look",
      ask: "Ask",
      help: "Help articles",
      hello: "Hi! What can I help with?",
      placeholder: "Ask anything about Gente…",
      search: "Search help",
      send: "Send",
      settings: "Settings",
      chips: ["Gente is slow", "Connect Telegram", "Plans and billing", "Is my data private?"],
      from: "From",
      helped: "Did this help?",
      yes: "Yes",
      no: "No",
      thanks: "Thanks!",
      human: "Talk to a person",
      fixing: "Working on it…",
      fixed: "Done. That should be fixed.",
      notFixed: "That didn't fix it. You can send this to a person.",
      ticketLead: "A person will read this and reply by email, usually within a day.",
      email: "Your email",
      whatHappened: "What happened?",
      includeReport: "Include an error report (no chats, no personal data)",
      sendTicket: "Send to a person",
      sending: "Sending…",
      sent: "Sent. We'll reply to your email.",
      notSent: "Couldn't send. Check your internet and try again.",
      badTicket: "Add your email and a short message.",
      reportTitle: "Gente hit a problem it couldn't fix by itself.",
      reportBody:
        "Send a private error report so we can fix it for everyone? It has error codes and app logs. Chats and personal data are removed.",
      reportSend: "Send report",
      reportAlways: "Always send",
      reportNotNow: "Not now",
      reportNever: "Never",
      reportSee: "See what's in it",
      reportSent: "Report sent. Thank you.",
      reportsHeading: "Error reports",
      reportsAsk: "Ask each time",
      reportsAlways: "Always send",
      reportsNever: "Never send",
      updatesHeading: "Updates",
      updatesLatest: "Regular",
      updatesCanary: "Early fixes",
      back: "← All articles",
      runCheck: "Check again",
      writing: "Writing an answer for you…",
      noResults: "No articles match. Try the Ask tab.",
    },
    es: {
      title: "Soporte",
      checking: "Revisando…",
      allGood: "Todo bien",
      needsLook: "1 cosa necesita atención",
      needsLookMany: "{n} cosas necesitan atención",
      ask: "Preguntar",
      help: "Artículos de ayuda",
      hello: "¡Hola! ¿En qué te ayudo?",
      placeholder: "Pregunta lo que sea sobre Gente…",
      search: "Buscar en la ayuda",
      send: "Enviar",
      settings: "Ajustes",
      chips: ["Gente va lento", "Conectar Telegram", "Planes y pagos", "¿Mis datos son privados?"],
      from: "De",
      helped: "¿Te ayudó?",
      yes: "Sí",
      no: "No",
      thanks: "¡Gracias!",
      human: "Hablar con una persona",
      fixing: "Trabajando en ello…",
      fixed: "Listo. Ya debería estar arreglado.",
      notFixed: "Eso no lo arregló. Puedes enviarlo a una persona.",
      ticketLead: "Una persona lo leerá y te responderá por correo, casi siempre en un día.",
      email: "Tu correo",
      whatHappened: "¿Qué pasó?",
      includeReport: "Incluir un reporte de error (sin chats ni datos personales)",
      sendTicket: "Enviar a una persona",
      sending: "Enviando…",
      sent: "Enviado. Te responderemos por correo.",
      notSent: "No se pudo enviar. Revisa tu internet e inténtalo otra vez.",
      badTicket: "Escribe tu correo y un mensaje corto.",
      reportTitle: "Gente tuvo un problema que no pudo arreglar solo.",
      reportBody:
        "¿Enviar un reporte privado de error para arreglarlo para todos? Tiene códigos de error y registros de la app. Se quitan los chats y los datos personales.",
      reportSend: "Enviar reporte",
      reportAlways: "Enviar siempre",
      reportNotNow: "Ahora no",
      reportNever: "Nunca",
      reportSee: "Ver qué contiene",
      reportSent: "Reporte enviado. Gracias.",
      reportsHeading: "Reportes de error",
      reportsAsk: "Preguntar cada vez",
      reportsAlways: "Enviar siempre",
      reportsNever: "No enviar nunca",
      updatesHeading: "Actualizaciones",
      updatesLatest: "Normales",
      updatesCanary: "Arreglos antes",
      back: "← Todos los artículos",
      runCheck: "Revisar otra vez",
      writing: "Escribiendo una respuesta para ti…",
      noResults: "Ningún artículo coincide. Prueba en Preguntar.",
    },
    pt: {
      title: "Suporte",
      checking: "Verificando…",
      allGood: "Tudo certo",
      needsLook: "1 coisa precisa de atenção",
      needsLookMany: "{n} coisas precisam de atenção",
      ask: "Perguntar",
      help: "Artigos de ajuda",
      hello: "Oi! Como posso ajudar?",
      placeholder: "Pergunte qualquer coisa sobre o Gente…",
      search: "Buscar na ajuda",
      send: "Enviar",
      settings: "Ajustes",
      chips: [
        "O Gente está lento",
        "Conectar o Telegram",
        "Planos e pagamento",
        "Meus dados são privados?",
      ],
      from: "De",
      helped: "Isso ajudou?",
      yes: "Sim",
      no: "Não",
      thanks: "Obrigado!",
      human: "Falar com uma pessoa",
      fixing: "Resolvendo…",
      fixed: "Pronto. Isso deve estar resolvido.",
      notFixed: "Isso não resolveu. Você pode enviar para uma pessoa.",
      ticketLead: "Uma pessoa vai ler e responder por e-mail, normalmente em um dia.",
      email: "Seu e-mail",
      whatHappened: "O que aconteceu?",
      includeReport: "Incluir um relatório de erro (sem conversas nem dados pessoais)",
      sendTicket: "Enviar para uma pessoa",
      sending: "Enviando…",
      sent: "Enviado. Vamos responder no seu e-mail.",
      notSent: "Não foi possível enviar. Verifique a internet e tente de novo.",
      badTicket: "Coloque seu e-mail e uma mensagem curta.",
      reportTitle: "O Gente teve um problema que não conseguiu resolver sozinho.",
      reportBody:
        "Enviar um relatório de erro privado para corrigirmos para todos? Ele tem códigos de erro e registros do app. Conversas e dados pessoais são removidos.",
      reportSend: "Enviar relatório",
      reportAlways: "Sempre enviar",
      reportNotNow: "Agora não",
      reportNever: "Nunca",
      reportSee: "Ver o que tem dentro",
      reportSent: "Relatório enviado. Obrigado.",
      reportsHeading: "Relatórios de erro",
      reportsAsk: "Perguntar sempre",
      reportsAlways: "Sempre enviar",
      reportsNever: "Nunca enviar",
      updatesHeading: "Atualizações",
      updatesLatest: "Normais",
      updatesCanary: "Correções antes",
      back: "← Todos os artigos",
      runCheck: "Verificar de novo",
      writing: "Escrevendo uma resposta para você…",
      noResults: "Nenhum artigo encontrado. Tente a aba Perguntar.",
    },
  };

  let state = null;
  let s = STRINGS.en;
  let articles = [];
  const history = [];
  const answers = new Map();

  const esc = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  /** Just enough formatting for answers: paragraphs, numbered and bulleted lists, bold. */
  function formatAnswer(text) {
    const clean = text
      .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
      .replace(/\[fix:[a-z-]+\]|\[human\]|\[fix:?[a-z-]*$|\[h?u?m?a?n?$/gi, "");
    const blocks = clean.trim().split(/\n{2,}/);
    return blocks
      .map((block) => {
        const lines = block.split("\n");
        const bold = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        if (lines.every((l) => /^\d+\.\s/.test(l)))
          return `<ol>${lines.map((l) => `<li>${bold(l.replace(/^\d+\.\s/, ""))}</li>`).join("")}</ol>`;
        if (lines.every((l) => /^[-*]\s/.test(l)))
          return `<ul>${lines.map((l) => `<li>${bold(l.replace(/^[-*]\s/, ""))}</li>`).join("")}</ul>`;
        return `<p>${lines.map(bold).join("<br>")}</p>`;
      })
      .join("");
  }

  function translate() {
    document.documentElement.lang = state?.lang ?? "en";
    for (const el of document.querySelectorAll("[data-t]"))
      el.textContent = s[el.dataset.t] ?? el.textContent;
    for (const el of document.querySelectorAll("[data-t-placeholder]"))
      el.placeholder = s[el.dataset.tPlaceholder];
    for (const el of document.querySelectorAll("[data-t-label]"))
      el.setAttribute("aria-label", s[el.dataset.tLabel]);
    const chips = $("chips");
    chips.replaceChildren(
      ...s.chips.map((label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", () => ask(label));
        return b;
      }),
    );
  }

  function renderStatus() {
    const dot = document.querySelector(".dot");
    const text = $("status-text");
    const checks = state?.health?.checks ?? [];
    if (!state?.health) {
      dot.dataset.tone = "unknown";
      text.textContent = s.checking;
    } else {
      const bad = checks.filter((c) => c.status === "fail");
      dot.dataset.tone = bad.length ? "fail" : state.health.overall === "warn" ? "warn" : "ok";
      text.textContent =
        bad.length === 0
          ? s.allGood
          : bad.length === 1
            ? s.needsLook
            : s.needsLookMany.replace("{n}", bad.length);
      // A problem opens the list by itself, so the fix is one tap away.
      if (bad.length && $("health").hidden && !renderStatus.opened) {
        renderStatus.opened = true;
        toggleHealth(true);
      }
    }
    const health = $("health");
    health.replaceChildren(
      ...checks.map((check) => {
        const row = document.createElement("div");
        row.className = "hc";
        row.dataset.status = check.status;
        const d = document.createElement("span");
        d.className = "dot";
        d.dataset.tone = check.status;
        const p = document.createElement("p");
        p.textContent = check.summary;
        row.append(d, p);
        if (check.status !== "ok" && check.fix) row.append(fixButton(check.fix));
        return row;
      }),
      (() => {
        const again = document.createElement("button");
        again.type = "button";
        again.className = "secondary";
        again.textContent = s.runCheck;
        again.addEventListener("click", async () => {
          again.disabled = true;
          setState(await api.check());
        });
        return again;
      })(),
    );
  }

  function toggleHealth(open) {
    const health = $("health");
    health.hidden = !open;
    $("status").setAttribute("aria-expanded", String(open));
  }

  function fixButton(id, after) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "primary";
    b.textContent = state?.fixLabels?.[id] ?? id;
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = s.fixing;
      const result = await api.fix(id);
      setState(result.state);
      b.textContent = result.ok ? s.fixed : s.notFixed;
      after?.(result.ok);
    });
    return b;
  }

  function renderReport() {
    const card = $("report");
    const pending = state?.pendingReport;
    card.hidden = !pending;
    if (!pending) return;
    card.innerHTML = `<p><strong>${esc(s.reportTitle)}</strong></p><p class="note">${esc(s.reportBody)}</p>`;
    const row = document.createElement("div");
    row.className = "row";
    const answer = (value, label, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      b.addEventListener("click", async () => {
        const ok = await api.answerReport(value);
        if (ok) {
          card.innerHTML = `<p class="note" data-tone="ok">${esc(s.reportSent)}</p>`;
          setTimeout(() => (card.hidden = true), 2500);
        }
      });
      return b;
    };
    const see = document.createElement("button");
    see.type = "button";
    see.className = "secondary";
    see.textContent = s.reportSee;
    see.addEventListener("click", () => {
      const pre = card.querySelector("pre") ?? document.createElement("pre");
      pre.textContent = pending.preview;
      card.append(pre);
    });
    row.append(
      answer("send", s.reportSend, "primary"),
      answer("always", s.reportAlways, "secondary"),
      answer("not-now", s.reportNotNow, "secondary"),
      see,
    );
    card.append(row);
  }

  function renderSettings() {
    const card = $("settings");
    const seg = (heading, key, options) => {
      const group = document.createElement("div");
      group.className = "group";
      const h = document.createElement("h2");
      h.textContent = heading;
      const wrap = document.createElement("div");
      wrap.className = "seg";
      for (const [value, label] of options) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.setAttribute("aria-pressed", String(state?.settings?.[key] === value));
        b.addEventListener("click", async () => {
          state.settings = await api.saveSettings({ [key]: value });
          renderSettings();
        });
        wrap.append(b);
      }
      group.append(h, wrap);
      return group;
    };
    card.replaceChildren(
      seg(s.reportsHeading, "shareDiagnostics", [
        ["ask", s.reportsAsk],
        ["always", s.reportsAlways],
        ["never", s.reportsNever],
      ]),
      seg(s.updatesHeading, "updateChannel", [
        ["latest", s.updatesLatest],
        ["canary", s.updatesCanary],
      ]),
    );
  }

  function setState(next) {
    const langChanged = !state || state.lang !== next.lang;
    state = next;
    s = STRINGS[state.lang] ?? STRINGS.en;
    if (langChanged) translate();
    renderStatus();
    renderReport();
    if (!$("settings").hidden) renderSettings();
  }

  const thread = $("thread");
  const scrollDown = () => (thread.scrollTop = thread.scrollHeight);

  function addMessage(role, html) {
    $("empty").hidden = true;
    const msg = document.createElement("div");
    msg.className = `msg ${role}`;
    if (role === "user") msg.textContent = html;
    else msg.innerHTML = html;
    thread.append(msg);
    scrollDown();
    return msg;
  }

  function ticketForm(prefill) {
    const form = $("ticket-form").content.firstElementChild.cloneNode(true);
    for (const el of form.querySelectorAll("[data-t]")) el.textContent = s[el.dataset.t];
    form.elements.message.value = prefill;
    const status = form.querySelector(".ticket-status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = form.elements.email.value.trim();
      const message = form.elements.message.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || message.length < 5) {
        status.textContent = s.badTicket;
        return;
      }
      const button = form.querySelector("button");
      button.disabled = true;
      status.textContent = s.sending;
      const ok = await api.ticket({
        email,
        name: "",
        message,
        includeReport: form.elements.includeReport.checked,
      });
      status.textContent = ok ? s.sent : s.notSent;
      button.disabled = ok;
    });
    return form;
  }

  function offerHuman(container) {
    if (container.querySelector(".human")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary human";
    b.textContent = s.human;
    b.addEventListener("click", () => {
      b.remove();
      const asked = history
        .filter((t) => t.role === "user")
        .map((t) => t.content)
        .join("\n");
      container.append(ticketForm(asked));
      scrollDown();
    });
    container.querySelector(".actions").append(b);
  }

  async function ask(question) {
    const text = question.trim();
    if (!text) return;
    addMessage("user", text);
    const bot = addMessage(
      "bot",
      `<div class="text"><span class="typing"><i></i><i></i><i></i></span></div>`,
    );
    $("send").disabled = true;
    const id = await api.ask(text, history.slice());
    history.push({ role: "user", content: text });
    answers.set(id, { el: bot, raw: "" });
    // Events can arrive before the id does; play back any that came early.
    for (const event of early.get(id) ?? []) handle(event);
    early.delete(id);
  }

  const early = new Map();
  api.onEvent((event) => {
    if (!answers.has(event.id)) {
      early.set(event.id, [...(early.get(event.id) ?? []), event]);
      return;
    }
    handle(event);
  });

  function handle(event) {
    const entry = answers.get(event.id);
    if (!entry) return;
    const { el } = entry;
    if (event.type === "sources" && event.sources.length) {
      entry.sources = event.sources;
    } else if (event.type === "preview") {
      // Instant: the best help section shows at once; the model's own answer replaces it.
      if (!entry.raw)
        el.querySelector(".text").innerHTML =
          `<div class="preview"><strong>${esc(event.heading)}</strong>${formatAnswer(event.text)}</div><span class="typing writing"><i></i><i></i><i></i> ${esc(s.writing)}</span>`;
      scrollDown();
    } else if (event.type === "token") {
      entry.raw += event.text;
      el.querySelector(".text").innerHTML = formatAnswer(entry.raw);
      scrollDown();
    } else if (event.type === "done") {
      $("send").disabled = false;
      answers.delete(event.id);
      history.push({ role: "assistant", content: event.text });
      el.querySelector(".text").innerHTML = formatAnswer(event.text);
      if (entry.sources?.length) {
        const sources = document.createElement("div");
        sources.className = "sources";
        sources.append(
          ...entry.sources.map((src) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = `${src.title} › ${src.heading}`;
            b.addEventListener("click", () => openArticle(src.slug, src.anchor));
            return b;
          }),
        );
        el.append(sources);
      }
      const actions = document.createElement("div");
      actions.className = "actions";
      el.append(actions);
      if (event.fix) actions.append(fixButton(event.fix, (ok) => !ok && offerHuman(el)));
      const helpful = document.createElement("span");
      helpful.className = "helpful";
      helpful.innerHTML = `${esc(s.helped)} `;
      for (const [value, label] of [
        [true, s.yes],
        [false, s.no],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", async () => {
          const result = await api.feedback(value);
          helpful.textContent = s.thanks;
          if (result.offerHuman) offerHuman(el);
        });
        helpful.append(b);
      }
      actions.append(helpful);
      if (event.offerHuman) offerHuman(el);
      scrollDown();
    }
  }

  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const q = $("question");
    const text = q.value;
    q.value = "";
    q.style.height = "";
    void ask(text);
  });
  $("question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("question").addEventListener("input", (event) => {
    event.target.style.height = "";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  });
  $("status").addEventListener("click", () => toggleHealth($("health").hidden));
  $("open-settings").addEventListener("click", () => {
    const card = $("settings");
    card.hidden = !card.hidden;
    if (!card.hidden) renderSettings();
  });

  function selectTab(name) {
    $("tab-ask").setAttribute("aria-selected", String(name === "ask"));
    $("tab-help").setAttribute("aria-selected", String(name === "help"));
    $("ask").hidden = name !== "ask";
    $("help").hidden = name !== "help";
  }
  $("tab-ask").addEventListener("click", () => selectTab("ask"));
  $("tab-help").addEventListener("click", async () => {
    selectTab("help");
    await loadArticles();
    showList();
  });

  async function loadArticles() {
    if (articles.length === 0) articles = await api.articles();
  }

  function showList(filter = $("help-search").value) {
    $("article").hidden = true;
    const list = $("articles");
    list.hidden = false;
    $("help-search").hidden = false;
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = articles.filter((a) =>
      words.every((w) => `${a.title} ${a.html}`.toLowerCase().includes(w)),
    );
    if (shown.length === 0) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = s.noResults;
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(
      ...shown.map((a) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        const lead = document.createElement("div");
        lead.innerHTML = a.html;
        const first = lead.querySelector("p")?.textContent ?? "";
        b.innerHTML = `<strong>${esc(a.title)}</strong><small>${esc(first.slice(0, 90))}${first.length > 90 ? "…" : ""}</small>`;
        b.addEventListener("click", () => openArticle(a.slug));
        li.append(b);
        return li;
      }),
    );
  }

  async function openArticle(slug, anchor) {
    selectTab("help");
    await loadArticles();
    const article = articles.find((a) => a.slug === slug);
    if (!article) return showList();
    $("articles").hidden = true;
    $("help-search").hidden = true;
    const view = $("article");
    view.hidden = false;
    view.innerHTML = `<button type="button" class="back">${esc(s.back)}</button>${article.html}`;
    view.querySelector(".back").addEventListener("click", () => showList());
    for (const link of view.querySelectorAll("a[data-article]"))
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void openArticle(link.dataset.article, link.dataset.anchor);
      });
    const target = anchor ? view.querySelector(`#${CSS.escape(anchor)}`) : null;
    (target ?? view).scrollIntoView({ block: "start" });
  }
  $("help-search").addEventListener("input", (event) => showList(event.target.value));

  const media = window.matchMedia("(prefers-color-scheme: light)");
  const theme = () => (document.documentElement.dataset.theme = media.matches ? "light" : "dark");
  theme();
  media.addEventListener("change", theme);

  api.onState(setState);
  void api.state().then(setState);
  void api.check().then(setState);
})();

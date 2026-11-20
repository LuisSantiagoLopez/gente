// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Plan prices and hours in the help articles come from Gente Cloud (GET /v1/billing/plans), never
// from hand-typed numbers. scripts/gente-plans.mjs saves the answer as docs/gente/help/plans.json
// at build time; the articles say {{plans-table}} and {{topup}}, and this fills them in.
import type { HelpLang } from "./help-docs.js";

export type BillingPlans = {
  plans: {
    id: string;
    monthlyCents: number | null;
    yearlyCents: number | null;
    currency: string;
    onlineHours: number | null;
    contactUs?: boolean;
  }[];
  free: { messagesLimit: number; onlineHours: number };
  topup: { cents: number; onlineHours: number };
};

const NAMES: Record<string, string> = {
  pro: "Pro",
  max: "Max",
  max_plus: "Max Plus",
  team: "Team",
  family: "Family",
  enterprise: "Enterprise",
};

const COPY = {
  en: {
    head: "| Plan | Price | What you get |",
    free: (n: number) => `${n} messages to try Your AI.`,
    first: (h: number) =>
      `Chats with your bots on your computer, plus **${h} hours** of online work each month.`,
    more: (h: number) => `Everything in Pro, with **${h} hours** of online work each month.`,
    month: "/month",
    year: "/year",
    or: "or",
    contact: "Talk to us",
    contactRow: "For several people. Ask Support for a price.",
    topup: (price: string, h: number) => `${price} for ${h} hours`,
  },
  es: {
    head: "| Plan | Precio | Qué incluye |",
    free: (n: number) => `${n} mensajes para probar Your AI.`,
    first: (h: number) =>
      `Chats con tus bots en tu computadora, más **${h} horas** de trabajo en línea cada mes.`,
    more: (h: number) => `Todo lo de Pro, con **${h} horas** de trabajo en línea cada mes.`,
    month: "/mes",
    year: "/año",
    or: "o",
    contact: "Escríbenos",
    contactRow: "Para varias personas. Pide un precio en Soporte.",
    topup: (price: string, h: number) => `${price} por ${h} horas`,
  },
  pt: {
    head: "| Plano | Preço | O que inclui |",
    free: (n: number) => `${n} mensagens para experimentar o Your AI.`,
    first: (h: number) =>
      `Conversas com seus bots no seu computador, mais **${h} horas** de trabalho online por mês.`,
    more: (h: number) => `Tudo do Pro, com **${h} horas** de trabalho online por mês.`,
    month: "/mês",
    year: "/ano",
    or: "ou",
    contact: "Fale com a gente",
    contactRow: "Para várias pessoas. Peça um preço no Suporte.",
    topup: (price: string, h: number) => `${price} por ${h} horas`,
  },
} as const;

function money(cents: number, currency: string): string {
  const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return currency.toLowerCase() === "usd" ? `US$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

export function plansTable(plans: BillingPlans, lang: HelpLang): string {
  const c = COPY[lang];
  const rows = [
    c.head,
    "| --- | --- | --- |",
    `| **Free** | ${money(0, "usd")} | ${c.free(plans.free.messagesLimit)} |`,
  ];
  const contact: string[] = [];
  let first = true;
  for (const plan of plans.plans) {
    const name = NAMES[plan.id] ?? plan.id;
    if (plan.contactUs || plan.monthlyCents === null || plan.onlineHours === null) {
      contact.push(name);
      continue;
    }
    const price = [
      `${money(plan.monthlyCents, plan.currency)}${c.month}`,
      ...(plan.yearlyCents !== null
        ? [`${c.or} ${money(plan.yearlyCents, plan.currency)}${c.year}`]
        : []),
    ].join(" ");
    rows.push(
      `| **${name}** | ${price} | ${first ? c.first(plan.onlineHours) : c.more(plan.onlineHours)} |`,
    );
    first = false;
  }
  if (contact.length > 0)
    rows.push(`| **${contact.join(", ")}** | ${c.contact} | ${c.contactRow} |`);
  return rows.join("\n");
}

/** Replaces {{plans-table}} and {{topup}} in an article; anything else is left as written. */
export function fillPlans(markdown: string, plans: BillingPlans | null, lang: HelpLang): string {
  if (plans === null) return markdown;
  return markdown
    .replaceAll("{{plans-table}}", plansTable(plans, lang))
    .replaceAll(
      "{{topup}}",
      COPY[lang].topup(money(plans.topup.cents, "usd"), plans.topup.onlineHours),
    );
}

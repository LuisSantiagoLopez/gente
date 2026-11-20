// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The tool scout: when Gente lacks an ability, it ranks the ways to get it, offers the best one
// in a single card, and keeps track of every tool it signed up for. Pure logic; the run decides
// when to call it, and approvals (terms, money) stay with the run's always-ask gate.

/** How Gente would reach the tool, best first: one tap, an official API, a website, a desktop app. */
export type ToolPath = "app" | "api" | "web" | "desktop";

export type ToolOption = {
  name: string;
  path: ToolPath;
  url: string;
  /** 0-1: how well it does the task the user asked for. */
  fit: number;
  freeTier: boolean;
  trialDays?: number;
  /** After any trial, in US dollars a month; 0 when the free tier is enough. */
  monthlyUsd?: number;
  /** Years the company has been around and its public review score (0-5), when known. */
  companyYears?: number;
  reviewScore?: number;
  /** Where the user's data goes: stays on the computer, only the request leaves, or content leaves. */
  privacy: "local" | "query" | "content";
  /** False when the site's terms forbid automated use; such a site is never driven by a browser. */
  automationAllowed?: boolean;
  /** Gente already built or connected it, so it is ready at once. */
  cached?: boolean;
  /** False for an open API that needs no account or key: nothing to sign up for or accept. */
  needsAccount?: boolean;
};

const PATH_SCORE: Record<ToolPath, number> = { app: 1, api: 0.85, web: 0.6, desktop: 0.45 };
const PRIVACY_SCORE = { local: 1, query: 0.8, content: 0.55 } as const;

/** One number per option: fit first, then how fast and safe it is to get, then cost and trust. */
export function scoreToolOption(option: ToolOption): number {
  const cost =
    option.freeTier || option.monthlyUsd === 0
      ? 1
      : option.trialDays
        ? 0.7
        : Math.max(0, 0.6 - (option.monthlyUsd ?? 50) / 200);
  // An app in the connection catalog was vetted when it was listed; elsewhere unknown is low.
  const unknownTrust = option.path === "app" ? 0.8 : 0.4;
  const trust =
    option.companyYears === undefined && option.reviewScore === undefined
      ? unknownTrust
      : Math.min(1, (option.companyYears ?? 0) / 5) * 0.5 + ((option.reviewScore ?? 2.5) / 5) * 0.5;
  return (
    option.fit * 0.45 +
    PATH_SCORE[option.path] * 0.15 +
    cost * 0.15 +
    trust * 0.1 +
    PRIVACY_SCORE[option.privacy] * 0.1 +
    (option.cached ? 0.05 : 0)
  );
}

/** Options Gente may use, best first. Sites that forbid automation drop out of the web path. */
export function rankToolOptions(options: readonly ToolOption[]): ToolOption[] {
  return options
    .filter(
      (option) => option.fit > 0 && !(option.path === "web" && option.automationAllowed === false),
    )
    .map((option) => ({ option, score: scoreToolOption(option) }))
    .sort((a, b) => b.score - a.score)
    .map(({ option }) => option);
}

function money(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

function afterTrial(monthlyUsd: number | undefined): string {
  return monthlyUsd === undefined
    ? "a price I'll confirm before it charges"
    : `${money(monthlyUsd)}/mo`;
}

/** The single card's sentence: what for, what it costs, and the one question. */
export function toolOfferText(task: string, option: ToolOption): string {
  const price =
    option.needsAccount === false
      ? "Free, no account needed."
      : option.freeTier || option.monthlyUsd === 0
        ? "Free plan, no card needed."
        : option.trialDays
          ? `Free trial, ${option.trialDays} days, then ${afterTrial(option.monthlyUsd)}. I'll remind you 2 days before it charges.`
          : option.monthlyUsd === undefined
            ? "Paid; I'll show the price before anything is charged."
            : `${money(option.monthlyUsd)}/mo.`;
  const how =
    option.path === "app"
      ? "Connect it?"
      : option.needsAccount === false
        ? "Use it?"
        : "Sign up and use it?";
  return `To ${task}, I need ${option.name}. ${price} ${how}`;
}

/** Which always-ask approvals the offer needs: accepting terms always; money when it can charge. */
export function toolOfferApprovals(option: ToolOption): Array<"legal" | "spend"> {
  if (option.path === "app" || option.needsAccount === false) return [];
  // An unknown price counts as one that can charge.
  const charges = !option.freeTier && (option.monthlyUsd ?? 1) > 0;
  return charges ? ["legal", "spend"] : ["legal"];
}

/** When to remind the user before a trial converts to paid: two days ahead, never in the past. */
export function trialReminderAt(trialEndsAt: Date, now: Date): Date {
  const reminder = new Date(trialEndsAt.getTime() - 2 * 24 * 60 * 60 * 1000);
  return reminder.getTime() > now.getTime() ? reminder : now;
}

/** One row of "Tools Gente signed up for". */
export type ToolSubscription = {
  name: string;
  url: string;
  startedAt: string;
  trialEndsAt?: string;
  monthlyUsd: number;
  status: "trial" | "free" | "paid" | "cancelled";
  cancelUrl?: string;
};

/** What the page's total line says: what is charged now, and what trials will add. */
export function subscriptionTotals(rows: readonly ToolSubscription[]): {
  monthlyNow: number;
  monthlyAfterTrials: number;
} {
  const live = rows.filter((row) => row.status !== "cancelled");
  return {
    monthlyNow: live
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + row.monthlyUsd, 0),
    monthlyAfterTrials: live
      .filter((row) => row.status === "paid" || row.status === "trial")
      .reduce((sum, row) => sum + row.monthlyUsd, 0),
  };
}

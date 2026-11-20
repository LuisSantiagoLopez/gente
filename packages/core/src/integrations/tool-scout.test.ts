import { describe, expect, it } from "vitest";
import type { ToolOption } from "./tool-scout.js";
import {
  rankToolOptions,
  subscriptionTotals,
  toolOfferApprovals,
  toolOfferText,
  trialReminderAt,
} from "./tool-scout.js";

const base = { url: "https://x.test", privacy: "query" as const };

describe("tool scout", () => {
  it("prefers a one-tap app, then a free official API, over a paid or less fitting tool", () => {
    const ranked = rankToolOptions([
      {
        ...base,
        name: "PaidOCR",
        path: "api",
        fit: 0.9,
        freeTier: false,
        monthlyUsd: 99,
        companyYears: 6,
        reviewScore: 4.5,
      },
      {
        ...base,
        name: "FreeOCR",
        path: "api",
        fit: 0.85,
        freeTier: true,
        companyYears: 4,
        reviewScore: 4.2,
      },
      { ...base, name: "WeakApp", path: "app", fit: 0.3, freeTier: true },
      { ...base, name: "AppOCR", path: "app", fit: 0.85, freeTier: true },
    ]);
    expect(ranked.map((option) => option.name)).toEqual([
      "AppOCR",
      "FreeOCR",
      "PaidOCR",
      "WeakApp",
    ]);
  });

  it("never offers a website whose terms forbid automation, and drops options that cannot do the task", () => {
    const ranked = rankToolOptions([
      { ...base, name: "NoBots", path: "web", fit: 1, freeTier: true, automationAllowed: false },
      { ...base, name: "Useless", path: "api", fit: 0, freeTier: true },
      { ...base, name: "Desk", path: "desktop", fit: 0.7, freeTier: true, privacy: "local" },
    ]);
    expect(ranked.map((option) => option.name)).toEqual(["Desk"]);
  });

  it("writes the one card and asks for terms always and money only when it can charge", () => {
    const trial: ToolOption = {
      ...base,
      name: "Deepgram",
      path: "api",
      fit: 0.9,
      freeTier: false,
      trialDays: 14,
      monthlyUsd: 19,
    };
    expect(toolOfferText("transcribe this call in Tagalog", trial)).toBe(
      "To transcribe this call in Tagalog, I need Deepgram. Free trial, 14 days, then $19/mo. I'll remind you 2 days before it charges. Sign up and use it?",
    );
    expect(toolOfferApprovals(trial)).toEqual(["legal", "spend"]);
    expect(toolOfferApprovals({ ...trial, freeTier: true, monthlyUsd: 0 })).toEqual(["legal"]);
    expect(toolOfferApprovals({ ...trial, path: "app" })).toEqual([]);
  });

  it("reminds two days before a trial charges, or now when that is already past", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    expect(trialReminderAt(new Date("2026-12-04T10:00:00Z"), now).toISOString()).toBe(
      "2026-12-02T10:00:00.000Z",
    );
    expect(trialReminderAt(new Date("2026-11-21T10:00:00Z"), now)).toEqual(now);
  });

  it("totals what is charged now and what trials will add", () => {
    expect(
      subscriptionTotals([
        { name: "A", url: "", startedAt: "", monthlyUsd: 19, status: "trial" },
        { name: "B", url: "", startedAt: "", monthlyUsd: 10, status: "paid" },
        { name: "C", url: "", startedAt: "", monthlyUsd: 50, status: "cancelled" },
        { name: "D", url: "", startedAt: "", monthlyUsd: 0, status: "free" },
      ]),
    ).toEqual({ monthlyNow: 10, monthlyAfterTrials: 29 });
  });
});

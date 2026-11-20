// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { simulateProactiveDays } from "./proactive-simulation.js";

describe("proactive engine, three simulated days", () => {
  it("acts toward goals, sends daily digests, and keeps every limit", async () => {
    const report = await simulateProactiveDays();
    expect(report.checks).toEqual({
      everyActionLinkedToGoal: true,
      noPingInQuietHours: true,
      pingsPerDayWithinLimit: true,
      actionsPerDayWithinCap: true,
      minutesPerDayWithinBudget: true,
      riskyWorkOnlyAfterApproval: true,
    });
    expect(report.days).toHaveLength(3);
    // One digest each evening.
    for (const day of report.days)
      expect(day.notifications.filter((note) => note.kind === "digest")).toHaveLength(1);
    // Risky work was held, and some of it went ahead only after the person said yes.
    expect(report.totals.heldForApproval).toBeGreaterThan(0);
    expect(report.startedRuns.filter((run) => run.risk).every((run) => run.approved)).toBe(true);
    // Every risk kind the plans contain was caught: money (ads) and send (recruiter email).
    const risks = new Set(report.state.actions.flatMap((action) => action.risk ?? []));
    expect([...risks].sort()).toEqual(["money", "send"]);
    // The goal the person kept rejecting was turned down; the one they liked kept going hard.
    const byGoal = Object.fromEntries(report.perGoal.map((goal) => [goal.goalId, goal]));
    expect(byGoal.job!.effectiveDial).toBe("quiet");
    expect(byGoal.etsy!.effectiveDial).toBe("go_hard");
    expect(report.totals.acceptanceRate).not.toBeNull();
  });

  it("is deterministic for a seed", async () => {
    const [first, second] = await Promise.all([simulateProactiveDays(), simulateProactiveDays()]);
    expect(second.totals).toEqual(first.totals);
    expect(second.perGoal).toEqual(first.perGoal);
  });
});

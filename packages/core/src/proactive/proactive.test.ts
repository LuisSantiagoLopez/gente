// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Goal, ProactiveAction, ProactiveDigest, ProactiveState } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { applyGoalChange, findSimilarGoal, newGoal, parseGoal, serializeGoal } from "./goals.js";
import { buildDigest, digestText, proactiveMetrics } from "./proactive-digest.js";
import type { PlannedAction, ProactivePorts } from "./proactive-engine.js";
import {
  approveAction,
  deadlineEvents,
  decideAction,
  recordRunOutcome,
  runProactiveCycle,
} from "./proactive-engine.js";
import {
  effectiveDial,
  emptyProactiveState,
  goalsDue,
  inQuietHours,
  localClock,
  mayNotify,
  proactiveRisk,
} from "./proactive-policy.js";

const NOW = "2026-11-20T15:00:00.000Z";

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return { ...newGoal({ id, title: `Goal ${id}`, source: "chat", now: NOW }), ...extra };
}

function action(goalId: string, extra: Partial<ProactiveAction> = {}): ProactiveAction {
  return {
    id: `a${Math.random().toString(36).slice(2, 8)}`,
    goalId,
    kind: "research",
    title: "Look into it",
    instructions: "",
    trigger: "schedule",
    status: "done",
    minutes: 15,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function fakePorts(input: {
  goals: Goal[];
  state?: ProactiveState;
  at: Date;
  plan?: (goalId: string, room: number) => PlannedAction[];
}) {
  let state = input.state ?? emptyProactiveState();
  let id = 0;
  const runs: string[] = [];
  const notes: Array<{ kind: string; digest: ProactiveDigest; at: string }> = [];
  const ports: ProactivePorts = {
    now: () => input.at,
    newId: () => `x${++id}`,
    loadGoals: async () => input.goals,
    loadState: async () => state,
    updateState: async (change) => {
      state = change(state);
      return state;
    },
    plan: async ({ goal, room }) =>
      input.plan?.(goal.id, room) ?? [
        { kind: "research", title: `Research for ${goal.title}`, instructions: "", minutes: 20 },
      ],
    startRun: async (planned) => {
      runs.push(planned.id);
      return `run-${planned.id}`;
    },
    notify: async (message) => {
      notes.push({ ...message, at: input.at.toISOString() });
    },
  };
  return { ports, runs, notes, state: () => state };
}

describe("goals", () => {
  it("round-trips, applies changes and finds the same goal said again", () => {
    const stored = newGoal({ id: "g1", title: "Grow my Etsy sales", source: "chat", now: NOW });
    expect(stored.dial).toBe("normal");
    expect(parseGoal(serializeGoal(stored))).toEqual(stored);
    expect(parseGoal("{nope")).toBeNull();
    const changed = applyGoalChange(stored, { progress: 140, linkProjectId: "p1" }, NOW);
    expect(changed.progress).toBe(100);
    expect(changed.projectIds).toEqual(["p1"]);
    expect(applyGoalChange(stored, {}, NOW)).toBe(stored);
    expect(findSimilarGoal([stored], "grow Etsy sales")?.id).toBe("g1");
    expect(findSimilarGoal([stored], "land a job")).toBeUndefined();
  });
});

describe("policy", () => {
  it("reads quiet hours in the person's own time zone, across midnight", () => {
    const settings = { ...emptyProactiveState().settings, timeZone: "America/Mexico_City" };
    // 15:00 UTC is 09:00 in Mexico City; 04:00 UTC is 22:00 the day before.
    expect(localClock(new Date(NOW), settings.timeZone).hour).toBe(9);
    expect(inQuietHours(new Date(NOW), settings)).toBe(false);
    expect(inQuietHours(new Date("2026-11-20T04:00:00Z"), settings)).toBe(true);
    expect(inQuietHours(new Date("2026-11-20T13:30:00Z"), settings)).toBe(true);
  });

  it("caps pings per day", () => {
    const state = emptyProactiveState({ maxNotificationsPerDay: 1 });
    expect(mayNotify(state, new Date(NOW))).toBe(true);
    const pinged = { ...state, notifications: [{ at: NOW, kind: "digest" as const }] };
    expect(mayNotify(pinged, new Date(NOW))).toBe(false);
  });

  it("turns a goal's dial down when the person keeps rejecting or undoing, never up", () => {
    const g = goal("g1", { dial: "go_hard" });
    const rejected = Array.from({ length: 4 }, () => action("g1", { verdict: "rejected" }));
    const mixed = [
      ...Array.from({ length: 2 }, () => action("g1", { verdict: "undone" })),
      ...Array.from({ length: 2 }, () => action("g1", { verdict: "accepted" })),
    ];
    expect(effectiveDial(g, { ...emptyProactiveState(), actions: rejected })).toBe("quiet");
    expect(effectiveDial(g, { ...emptyProactiveState(), actions: mixed })).toBe("normal");
    const liked = Array.from({ length: 6 }, () => action("g1", { verdict: "accepted" }));
    expect(
      effectiveDial(goal("g2", { dial: "quiet" }), {
        ...emptyProactiveState(),
        actions: liked.map((a) => ({ ...a, goalId: "g2" })),
      }),
    ).toBe("quiet");
  });

  it("only picks active goals, waits for cadence unless an event wakes the goal, and holds caps", () => {
    const at = new Date(NOW);
    const recent = action("g1", { createdAt: "2026-11-20T14:00:00.000Z" });
    const state = { ...emptyProactiveState(), actions: [recent] };
    const goals = [goal("g1"), goal("g2", { status: "paused" })];
    expect(goalsDue(goals, state, at)).toEqual([]);
    const woken = goalsDue(goals, state, at, [
      { trigger: "email", goalId: "g1", summary: "recruiter replied" },
    ]);
    expect(woken.map((slot) => [slot.goal.id, slot.trigger, slot.room])).toEqual([
      ["g1", "email", 1],
    ]);
    const full = { ...emptyProactiveState({ dailyActionCap: 1 }), actions: [action("g9")] };
    expect(goalsDue([goal("g1")], full, at)).toEqual([]);
    const spent = { ...emptyProactiveState({ hoursBudgetPerDay: 0.25 }), actions: [action("g9")] };
    expect(goalsDue([goal("g1")], spent, at)).toEqual([]);
  });

  it("flags the four things a person decides, and not a promise not to do them", () => {
    expect(proactiveRisk({ title: "Pay for Etsy ads", instructions: "" })).toBe("money");
    expect(proactiveRisk({ title: "Send the cover letter to Acme", instructions: "" })).toBe(
      "send",
    );
    expect(proactiveRisk({ title: "Delete old listings", instructions: "" })).toBe("delete");
    expect(proactiveRisk({ title: "Accept the terms of the beta", instructions: "" })).toBe(
      "legal",
    );
    expect(
      proactiveRisk({ title: "Draft a cover letter", instructions: "Do not send it; save it." }),
    ).toBeNull();
    expect(proactiveRisk({ title: "Research competitor prices", instructions: "" })).toBeNull();
  });
});

describe("engine", () => {
  it("starts safe work as runs, holds risky work for approval, and links every action to a goal", async () => {
    const fake = fakePorts({
      goals: [goal("g1")],
      at: new Date(NOW),
      plan: () => [
        { kind: "research", title: "Compare shipping rates", instructions: "", minutes: 20 },
        { kind: "build", title: "Buy a domain", instructions: "", minutes: 10 },
      ],
    });
    const report = await runProactiveCycle(fake.ports);
    expect(report.started.map((a) => a.title)).toEqual(["Compare shipping rates"]);
    expect(report.waiting.map((a) => [a.title, a.risk, a.status])).toEqual([
      ["Buy a domain", "money", "needs_approval"],
    ]);
    expect(fake.runs).toEqual([report.started[0]!.id]);
    expect(fake.state().actions.every((a) => a.goalId === "g1")).toBe(true);
    // The waiting work pinged once.
    expect(fake.notes.map((n) => n.kind)).toEqual(["approval"]);

    const skipped = await approveAction(fake.ports, report.waiting[0]!.id, false);
    expect(skipped.status).toBe("skipped");
    expect(fake.runs).toHaveLength(1);
  });

  it("does nothing without an active goal", async () => {
    const fake = fakePorts({ goals: [goal("g1", { status: "done" })], at: new Date(NOW) });
    const report = await runProactiveCycle(fake.ports);
    expect(report.started).toEqual([]);
    expect(fake.state().actions).toEqual([]);
  });

  it("sends the digest once a day, after the digest hour, never at night", async () => {
    const done = action("g1", { title: "Researched suppliers", result: "Three options saved" });
    const base = { ...emptyProactiveState({ digestHour: 18 }), actions: [done] };
    const evening = fakePorts({ goals: [], state: base, at: new Date("2026-11-20T18:30:00Z") });
    expect((await runProactiveCycle(evening.ports)).digestSent).toBe(true);
    expect(evening.notes[0]!.digest.headline).toBe("Did 1 thing for you today");
    expect((await runProactiveCycle(evening.ports)).digestSent).toBe(false);
    const night = fakePorts({ goals: [], state: base, at: new Date("2026-11-20T22:30:00Z") });
    expect((await runProactiveCycle(night.ports)).digestSent).toBe(false);
  });

  it("records outcomes and verdicts, and reports acceptance and undo rates", () => {
    const queued = action("g1", { status: "queued", runId: "r1" });
    let state: ProactiveState = { ...emptyProactiveState(), actions: [queued] };
    state = recordRunOutcome(state, "r1", { ok: true, result: "Saved a draft" }, NOW);
    expect(state.actions[0]).toMatchObject({ status: "done", result: "Saved a draft" });
    state = decideAction(state, queued.id, "undone", NOW);
    const metrics = proactiveMetrics(state, [goal("g1")]);
    expect(metrics).toMatchObject({ acceptanceRate: 0, undoRate: 1, decided: 1 });
    expect(() => decideAction(state, "missing", "accepted", NOW)).toThrow("no longer here");
    const digest = buildDigest(state, new Date(NOW));
    expect(digestText(digest, [goal("g1")])).toContain("Did 1 thing for you today:");
  });

  it("wakes a goal whose deadline is close", () => {
    const soon = goal("g1", { deadline: "2026-11-22T00:00:00.000Z" });
    const later = goal("g2", { deadline: "2026-12-30T00:00:00.000Z" });
    expect(deadlineEvents([soon, later], new Date(NOW)).map((e) => e.goalId)).toEqual(["g1"]);
  });
});

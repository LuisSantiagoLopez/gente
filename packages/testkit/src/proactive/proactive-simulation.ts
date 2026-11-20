// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Three days of Gente's proactive engine on a fake clock, one hour per step: goals are set on the
// first morning, the real engine plans and starts work, events wake goals, digests go out, and a
// scripted person accepts, rejects, undoes and approves by a fixed seeded policy. No model and no
// database: the planner is scripted and the state lives in memory, so every run is the same.
//
//   pnpm exec tsx packages/testkit/src/proactive/proactive-simulation.ts [output folder]
import type { Goal, ProactiveAction, ProactiveDigest, ProactiveState } from "@rakazo/contracts";
import type { PlannedAction, ProactiveEvent, ProactivePorts } from "@rakazo/core";
import {
  applyGoalChange,
  approveAction,
  decideAction,
  emptyProactiveState,
  inQuietHours,
  localClock,
  newGoal,
  proactiveMetrics,
  recordRunOutcome,
  runProactiveCycle,
} from "@rakazo/core";

export const SIM_TIME_ZONE = "America/Mexico_City";
/** Midnight in Mexico City on the first day; goals arrive at 08:00. */
export const SIM_START = new Date("2026-11-23T06:00:00.000Z");
const GOALS_SET_AT_HOUR = 8;
export const SIM_HOURS = 72;
export const SIM_SEED = 20261119;

/** A small seeded random source (mulberry32), so the person's choices repeat exactly. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLANS: Record<string, PlannedAction[]> = {
  etsy: [
    {
      kind: "research",
      title: "Find the 5 best-selling ceramic mugs on Etsy this month",
      instructions: "List price, photos and tags.",
      minutes: 15,
    },
    {
      kind: "draft",
      title: "Rewrite 3 listing titles with stronger search words",
      instructions: "Save as drafts for review.",
      minutes: 10,
    },
    { kind: "build", title: "Pay $20 to boost the top listing", instructions: "", minutes: 5 },
    {
      kind: "update",
      title: "Update the shop project with this week's sales",
      instructions: "",
      minutes: 5,
    },
    {
      kind: "research",
      title: "Compare packaging suppliers after the price drop",
      instructions: "",
      minutes: 15,
    },
  ],
  job: [
    {
      kind: "research",
      title: "Find 5 open product design roles that fit the portfolio",
      instructions: "",
      minutes: 15,
    },
    {
      kind: "draft",
      title: "Draft a cover letter for the best match",
      instructions: "Do not send it; save it for review.",
      minutes: 15,
    },
    {
      kind: "follow_up",
      title: "Send a follow-up email to the recruiter",
      instructions: "",
      minutes: 5,
    },
    {
      kind: "draft",
      title: "Prepare answers for a portfolio review",
      instructions: "",
      minutes: 15,
    },
  ],
  app: [
    { kind: "build", title: "Fix the crash on the streaks screen", instructions: "", minutes: 20 },
    { kind: "draft", title: "Draft App Store release notes", instructions: "", minutes: 10 },
    {
      kind: "research",
      title: "Check what blocks the TestFlight review",
      instructions: "",
      minutes: 10,
    },
    { kind: "update", title: "Move the launch checklist forward", instructions: "", minutes: 5 },
  ],
};

/** How likely the scripted person is to accept finished work, and to undo what they accepted. */
const TASTE: Record<string, { accept: number; undo: number }> = {
  etsy: { accept: 0.85, undo: 0.05 },
  job: { accept: 0.7, undo: 0.1 },
  app: { accept: 0.3, undo: 0.35 },
};

const EVENTS: Array<{ hour: number; event: ProactiveEvent }> = [
  { hour: 34, event: { trigger: "email", goalId: "job", summary: "A recruiter replied" } },
  {
    hour: 38,
    event: { trigger: "project_stalled", goalId: "app", summary: "No progress in 3 days" },
  },
  {
    hour: 59,
    event: {
      trigger: "price_drop",
      goalId: "etsy",
      summary: "Packaging supplier dropped prices 15%",
    },
  },
];

export type SimulationDay = {
  day: string;
  started: number;
  waitingForApproval: number;
  approved: number;
  notifications: Array<{ localTime: string; kind: string; headline: string }>;
  acceptanceRate: number | null;
};

export type SimulationReport = {
  seed: number;
  timeZone: string;
  hours: number;
  goals: Array<{ id: string; title: string; dial: string }>;
  days: SimulationDay[];
  totals: {
    actions: number;
    done: number;
    heldForApproval: number;
    approved: number;
    skipped: number;
    notifications: number;
    acceptanceRate: number | null;
    undoRate: number | null;
  };
  perGoal: Array<{
    goalId: string;
    actions: number;
    accepted: number;
    rejected: number;
    undone: number;
    acceptanceRate: number | null;
    undoRate: number | null;
    progress: number;
    dial: string;
    effectiveDial: string;
  }>;
  checks: {
    everyActionLinkedToGoal: boolean;
    noPingInQuietHours: boolean;
    pingsPerDayWithinLimit: boolean;
    actionsPerDayWithinCap: boolean;
    minutesPerDayWithinBudget: boolean;
    riskyWorkOnlyAfterApproval: boolean;
  };
  state: ProactiveState;
  notifications: Array<{ at: string; kind: string; digest: ProactiveDigest }>;
  startedRuns: Array<{ actionId: string; risk?: string; approved: boolean }>;
};

export async function simulateProactiveDays(seed = SIM_SEED): Promise<SimulationReport> {
  const random = seeded(seed);
  let clock = SIM_START;
  let state = emptyProactiveState({ timeZone: SIM_TIME_ZONE });
  let goals: Goal[] = [];
  let nextId = 0;
  const pending = new Map<string, string>(); // runId -> actionId
  const notifications: SimulationReport["notifications"] = [];
  const startedRuns: SimulationReport["startedRuns"] = [];
  const approvedIds = new Set<string>();
  const planCursor: Record<string, number> = { etsy: 0, job: 0, app: 0 };
  const ports: ProactivePorts = {
    now: () => clock,
    newId: () => `a${++nextId}`,
    loadGoals: async () => goals,
    loadState: async () => state,
    updateState: async (change) => {
      state = change(state);
      return state;
    },
    plan: async ({ goal, room }) => {
      const library = PLANS[goal.id]!;
      return Array.from({ length: room }, () => library[planCursor[goal.id]!++ % library.length]!);
    },
    startRun: async (action: ProactiveAction) => {
      startedRuns.push({
        actionId: action.id,
        ...(action.risk ? { risk: action.risk } : {}),
        approved: approvedIds.has(action.id),
      });
      const runId = `run-${action.id}`;
      pending.set(runId, action.id);
      return runId;
    },
    notify: async (message) => {
      notifications.push({ at: clock.toISOString(), ...message });
    },
  };

  const now = () => clock.toISOString();
  for (let hour = 0; hour < SIM_HOURS; hour += 1) {
    clock = new Date(SIM_START.getTime() + hour * 60 * 60 * 1000);
    if (hour < GOALS_SET_AT_HOUR) continue;
    if (hour === GOALS_SET_AT_HOUR) {
      // First morning: onboarding, a chat and a project each give Gente a goal.
      goals = [
        newGoal({
          id: "etsy",
          title: "Grow my Etsy sales",
          source: "onboarding",
          dial: "go_hard",
          now: now(),
        }),
        newGoal({
          id: "job",
          title: "Land a product design job",
          source: "chat",
          now: now(),
          deadline: new Date(SIM_START.getTime() + 68 * 3600_000).toISOString(),
        }),
        newGoal({
          id: "app",
          title: "Ship my habit app",
          source: "project",
          projectId: "p-app",
          now: now(),
        }),
      ];
    }
    // Runs started last hour finish now.
    for (const [runId, actionId] of pending) {
      const action = state.actions.find((candidate) => candidate.id === actionId)!;
      state = recordRunOutcome(
        state,
        runId,
        { ok: true, result: `Done: ${action.title.toLowerCase()}` },
        now(),
      );
      pending.delete(runId);
    }
    const events = EVENTS.filter((entry) => entry.hour === hour).map((entry) => entry.event);
    const before = notifications.length;
    await runProactiveCycle(ports, events);
    // The person reads each ping and answers what it shows.
    for (const note of notifications.slice(before)) {
      for (const waiting of note.digest.waiting) {
        const approve = random() < 0.5;
        if (approve) approvedIds.add(waiting.id);
        await approveAction(ports, waiting.id, approve);
      }
      if (note.kind !== "digest") continue;
      for (const item of note.digest.items) {
        if (item.verdict) continue;
        const taste = TASTE[item.goalId]!;
        const accepted = random() < taste.accept;
        const verdict = accepted ? (random() < taste.undo ? "undone" : "accepted") : "rejected";
        state = decideAction(state, item.id, verdict, now());
        if (verdict === "accepted")
          goals = goals.map((goal) =>
            goal.id === item.goalId
              ? applyGoalChange(goal, { progress: goal.progress + 5 }, now())
              : goal,
          );
      }
    }
  }

  const metrics = proactiveMetrics(state, goals);
  const dayOf = (iso: string) => localClock(new Date(iso), SIM_TIME_ZONE).day;
  const days = [...new Set(state.actions.map((action) => dayOf(action.createdAt)))].sort();
  const reportDays: SimulationDay[] = days.map((day) => {
    const actions = state.actions.filter((action) => dayOf(action.createdAt) === day);
    const decided = actions.filter((action) => action.verdict);
    const accepted = decided.filter((action) => action.verdict === "accepted").length;
    return {
      day,
      started: actions.filter((action) => action.runId).length,
      waitingForApproval: actions.filter((action) => action.risk).length,
      approved: actions.filter((action) => action.risk && action.runId).length,
      notifications: notifications
        .filter((note) => dayOf(note.at) === day)
        .map((note) => ({
          localTime: new Intl.DateTimeFormat("en-GB", {
            timeZone: SIM_TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(note.at)),
          kind: note.kind,
          headline:
            note.kind === "digest"
              ? note.digest.headline
              : `${note.digest.waiting.length} waiting for your OK`,
        })),
      acceptanceRate: decided.length ? Math.round((accepted / decided.length) * 1000) / 1000 : null,
    };
  });
  const perDay = (pick: (iso: string) => boolean) =>
    days.map((day) =>
      state.actions.filter((action) => dayOf(action.createdAt) === day && pick(action.createdAt)),
    );
  const goalIds = new Set(goals.map((goal) => goal.id));
  const checks = {
    everyActionLinkedToGoal: state.actions.every((action) => goalIds.has(action.goalId)),
    noPingInQuietHours: notifications.every(
      (note) => !inQuietHours(new Date(note.at), state.settings),
    ),
    pingsPerDayWithinLimit: days.every(
      (day) =>
        notifications.filter((note) => dayOf(note.at) === day).length <=
        state.settings.maxNotificationsPerDay,
    ),
    actionsPerDayWithinCap: perDay(() => true).every(
      (actions) =>
        actions.filter((action) => action.status !== "skipped").length <=
        state.settings.dailyActionCap,
    ),
    minutesPerDayWithinBudget: perDay(() => true).every(
      (actions) =>
        actions
          .filter((action) => action.status !== "skipped")
          .reduce((sum, action) => sum + action.minutes, 0) <=
        state.settings.hoursBudgetPerDay * 60,
    ),
    riskyWorkOnlyAfterApproval: startedRuns.every((run) => !run.risk || run.approved),
  };
  return {
    seed,
    timeZone: SIM_TIME_ZONE,
    hours: SIM_HOURS,
    goals: goals.map((goal) => ({ id: goal.id, title: goal.title, dial: goal.dial })),
    days: reportDays,
    totals: {
      actions: state.actions.length,
      done: state.actions.filter((action) => action.status === "done").length,
      heldForApproval: state.actions.filter((action) => action.risk).length,
      approved: startedRuns.filter((run) => run.risk).length,
      skipped: state.actions.filter((action) => action.status === "skipped").length,
      notifications: notifications.length,
      acceptanceRate: metrics.acceptanceRate,
      undoRate: metrics.undoRate,
    },
    perGoal: metrics.goals.map(({ title: _title, ...goal }) => goal),
    checks,
    state,
    notifications,
    startedRuns,
  };
}

function markdown(report: SimulationReport): string {
  const pct = (value: number | null) =>
    value === null ? "n/a" : `${Math.round(value * 1000) / 10}%`;
  const lines = [
    "# Proactive engine: 3-day simulation",
    "",
    `Fake clock, one step per hour for ${report.hours} hours, time zone ${report.timeZone}, seed ${report.seed}. Scripted planner and person; the engine, caps, quiet hours, digest and approval hold are the real code.`,
    "",
    "## Totals",
    "",
    `- Actions planned: ${report.totals.actions} (done ${report.totals.done}, held for approval ${report.totals.heldForApproval}, approved and started ${report.totals.approved}, skipped ${report.totals.skipped})`,
    `- Pings: ${report.totals.notifications}`,
    `- Acceptance rate: ${pct(report.totals.acceptanceRate)}`,
    `- Undo rate: ${pct(report.totals.undoRate)}`,
    "",
    "## Per goal",
    "",
    "| Goal | Actions | Accepted | Rejected | Undone | Acceptance | Undo | Progress | Dial | Dial in use |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...report.perGoal.map(
      (goal) =>
        `| ${report.goals.find((g) => g.id === goal.goalId)?.title} | ${goal.actions} | ${goal.accepted} | ${goal.rejected} | ${goal.undone} | ${pct(goal.acceptanceRate)} | ${pct(goal.undoRate)} | ${goal.progress}% | ${goal.dial} | ${goal.effectiveDial} |`,
    ),
    "",
    "## Per day",
    "",
    "| Day | Started | Held for approval | Approved | Pings (local time) | Acceptance |",
    "|---|---|---|---|---|---|",
    ...report.days.map(
      (day) =>
        `| ${day.day} | ${day.started} | ${day.waitingForApproval} | ${day.approved} | ${day.notifications.map((n) => `${n.localTime} ${n.headline}`).join("; ")} | ${pct(day.acceptanceRate)} |`,
    ),
    "",
    "## Checks",
    "",
    ...Object.entries(report.checks).map(([name, ok]) => `- ${name}: ${ok ? "pass" : "FAIL"}`),
    "",
  ];
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const out = path.resolve(process.argv[2] ?? "docs/gente/learn/proactive");
  mkdirSync(out, { recursive: true });
  const report = await simulateProactiveDays();
  const { state: _state, notifications: _n, startedRuns: _r, ...summary } = report;
  writeFileSync(path.join(out, "simulation.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(out, "README.md"), markdown(report));
  console.log(markdown(report));
}

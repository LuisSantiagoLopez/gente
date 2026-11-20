// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type {
  Goal,
  ProactiveAction,
  ProactiveDial,
  ProactiveRisk,
  ProactiveSettings,
  ProactiveState,
  ProactiveTrigger,
} from "@rakazo/contracts";
import { screenActionRisk } from "../runs/screen-action-risk.js";

/** What each dial lets Gente do for one goal on its own. */
export const PROACTIVE_DIALS: Record<ProactiveDial, { perDay: number; cadenceHours: number }> = {
  quiet: { perDay: 1, cadenceHours: 24 },
  normal: { perDay: 2, cadenceHours: 8 },
  go_hard: { perDay: 5, cadenceHours: 3 },
};

const DIAL_ORDER: readonly ProactiveDial[] = ["quiet", "normal", "go_hard"];

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  timeZone: "UTC",
  quietStart: 21,
  quietEnd: 8,
  digestHour: 18,
  maxNotificationsPerDay: 3,
  dailyActionCap: 8,
  hoursBudgetPerDay: 2,
};

export function emptyProactiveState(settings?: Partial<ProactiveSettings>): ProactiveState {
  return {
    settings: { ...DEFAULT_PROACTIVE_SETTINGS, ...settings },
    actions: [],
    notifications: [],
  };
}

/** The newest actions are kept; older ones stay in the document's revisions. */
export const MAX_PROACTIVE_ACTIONS = 500;
const MAX_NOTIFICATIONS_KEPT = 200;

export function trimProactiveState(state: ProactiveState): ProactiveState {
  return {
    ...state,
    actions: state.actions.slice(-MAX_PROACTIVE_ACTIONS),
    notifications: state.notifications.slice(-MAX_NOTIFICATIONS_KEPT),
  };
}

function zoneOrUtc(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The person's local date (YYYY-MM-DD) and hour for a moment. */
export function localClock(at: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zoneOrUtc(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")) % 24,
  };
}

/** No pings at night: quietStart up to quietEnd in the person's own time, wrapping midnight. */
export function inQuietHours(at: Date, settings: ProactiveSettings): boolean {
  const { hour } = localClock(at, settings.timeZone);
  const { quietStart: start, quietEnd: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function sameLocalDay(iso: string, day: string, timeZone: string): boolean {
  return localClock(new Date(iso), timeZone).day === day;
}

export function actionsOnDay(state: ProactiveState, at: Date): ProactiveAction[] {
  const { day } = localClock(at, state.settings.timeZone);
  return state.actions.filter((action) =>
    sameLocalDay(action.createdAt, day, state.settings.timeZone),
  );
}

/** Work that counts toward the day's caps: anything planned that wasn't skipped. */
function counts(action: ProactiveAction): boolean {
  return action.status !== "skipped";
}

export function notificationsOnDay(state: ProactiveState, at: Date): number {
  const { day } = localClock(at, state.settings.timeZone);
  return state.notifications.filter((note) => sameLocalDay(note.at, day, state.settings.timeZone))
    .length;
}

/** Whether a ping may go out now: never at night and never past the day's limit. */
export function mayNotify(state: ProactiveState, at: Date): boolean {
  return (
    !inQuietHours(at, state.settings) &&
    notificationsOnDay(state, at) < state.settings.maxNotificationsPerDay
  );
}

/** How the person has answered this goal's recent work. */
export function goalFeedback(state: ProactiveState, goalId: string, window = 10) {
  const decided = state.actions
    .filter((action) => action.goalId === goalId && action.verdict)
    .slice(-window);
  const accepted = decided.filter((action) => action.verdict === "accepted").length;
  const rejected = decided.filter((action) => action.verdict === "rejected").length;
  const undone = decided.filter((action) => action.verdict === "undone").length;
  return { decided: decided.length, accepted, rejected, undone };
}

/**
 * The dial Gente actually uses: the person's own, turned down when they keep rejecting or undoing
 * this goal's work. It never turns up past what the person chose.
 */
export function effectiveDial(goal: Goal, state: ProactiveState): ProactiveDial {
  const feedback = goalFeedback(state, goal.id);
  if (feedback.decided < 4) return goal.dial;
  const pushback = (feedback.rejected + feedback.undone) / feedback.decided;
  const index = DIAL_ORDER.indexOf(goal.dial);
  if (pushback >= 0.75) return "quiet";
  if (pushback >= 0.5) return DIAL_ORDER[Math.max(0, index - 1)]!;
  return goal.dial;
}

export type ProactiveEvent = {
  trigger: Exclude<ProactiveTrigger, "schedule">;
  /** The goal it concerns; an event with no goal only wakes goals whose words it shares. */
  goalId?: string;
  summary: string;
};

export type GoalSlot = {
  goal: Goal;
  trigger: ProactiveTrigger;
  /** How many actions this goal may still take today. */
  room: number;
  dial: ProactiveDial;
};

/** Event triggers that may wake a goal before its cadence comes round. */
function eventFor(goal: Goal, events: readonly ProactiveEvent[]): ProactiveEvent | undefined {
  const words = goal.title
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
  return events.find(
    (event) =>
      event.goalId === goal.id ||
      (!event.goalId && words.some((word) => event.summary.toLowerCase().includes(word))),
  );
}

export function minutesUsedOnDay(state: ProactiveState, at: Date): number {
  return actionsOnDay(state, at)
    .filter(counts)
    .reduce((sum, action) => sum + action.minutes, 0);
}

/**
 * The goals that get work now, each with how much more it may take today. Only active goals are
 * ever chosen, so no work happens without a goal behind it. A goal waits for its dial's cadence
 * unless an event about it arrived; the per-goal and daily caps and the hours budget always hold.
 */
export function goalsDue(
  goals: readonly Goal[],
  state: ProactiveState,
  at: Date,
  events: readonly ProactiveEvent[] = [],
): GoalSlot[] {
  if (!state.settings.enabled) return [];
  const today = actionsOnDay(state, at).filter(counts);
  let dailyRoom = state.settings.dailyActionCap - today.length;
  if (dailyRoom <= 0) return [];
  if (minutesUsedOnDay(state, at) >= state.settings.hoursBudgetPerDay * 60) return [];
  const slots: GoalSlot[] = [];
  for (const goal of goals) {
    if (goal.status !== "active" || dailyRoom <= 0) continue;
    const dial = effectiveDial(goal, state);
    const rules = PROACTIVE_DIALS[dial];
    const doneToday = today.filter((action) => action.goalId === goal.id).length;
    const room = Math.min(rules.perDay - doneToday, dailyRoom);
    if (room <= 0) continue;
    const last = state.actions.filter((action) => action.goalId === goal.id).at(-1);
    const event = eventFor(goal, events);
    const cadenceDue =
      !last ||
      at.getTime() - new Date(last.createdAt).getTime() >= rules.cadenceHours * 60 * 60 * 1000;
    if (!event && !cadenceDue) continue;
    slots.push({ goal, trigger: event?.trigger ?? "schedule", room, dial });
    dailyRoom -= room;
  }
  return slots;
}

/**
 * Which of the four things a person always decides this planned work would do, read from what
 * the planner wrote. Shared with the screen check so both stop at the same words.
 */
export function proactiveRisk(action: {
  title: string;
  instructions: string;
}): ProactiveRisk | null {
  // "Do not send it" is a promise not to, not an intent to; everything else is read as written.
  const said = `${action.title}. ${action.instructions}`.replace(
    /\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,2}?(?:send|post|share|submit|publish|pay|buy|delete|sign|agree)\w*/gi,
    " ",
  );
  return screenActionRisk({ app: "", actions: [], purpose: said });
}

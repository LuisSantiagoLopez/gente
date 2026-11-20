// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import * as z from "zod";
import { Id, IsoDate } from "../ids.js";

/**
 * Goals and Gente's own proactive log live in the Space's memory documents under their own
 * scopes, like brains and projects: encrypted, revisioned, on this computer, never in the plain
 * memory screens or the prompt's memory block.
 */
export const GOAL_MEMORY_SCOPE = "goal";
export const PROACTIVE_MEMORY_SCOPE = "proactive";

/** How much Gente does for a goal on its own. */
export const ProactiveDialSchema = z.enum(["quiet", "normal", "go_hard"]);
export type ProactiveDial = z.infer<typeof ProactiveDialSchema>;

export const GoalStatusSchema = z.enum(["active", "paused", "done"]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalSourceSchema = z.enum(["chat", "project", "onboarding", "user"]);
export type GoalSource = z.infer<typeof GoalSourceSchema>;

export const GoalSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  /** What done looks like, in the person's words. */
  outcome: z.string().max(500).default(""),
  status: GoalStatusSchema,
  dial: ProactiveDialSchema,
  source: GoalSourceSchema,
  /** 0 to 100, set by the bot or the person. */
  progress: z.number().int().min(0).max(100),
  deadline: IsoDate.optional(),
  projectIds: z.array(z.string().min(1).max(40)).max(20),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Goal = z.infer<typeof GoalSchema>;

export const ProactiveActionKindSchema = z.enum([
  "research",
  "draft",
  "update",
  "follow_up",
  "build",
]);
export type ProactiveActionKind = z.infer<typeof ProactiveActionKindSchema>;

/** The four things the person always decides. */
export const ProactiveRiskSchema = z.enum(["money", "send", "delete", "legal"]);
export type ProactiveRisk = z.infer<typeof ProactiveRiskSchema>;

export const ProactiveTriggerSchema = z.enum([
  "schedule",
  "email",
  "calendar",
  "price_drop",
  "project_stalled",
  "deadline_near",
]);
export type ProactiveTrigger = z.infer<typeof ProactiveTriggerSchema>;

export const ProactiveActionStatusSchema = z.enum([
  /** Waiting for the person: it would spend, send as them, delete or agree to terms. */
  "needs_approval",
  "queued",
  "done",
  "failed",
  "skipped",
]);
export type ProactiveActionStatus = z.infer<typeof ProactiveActionStatusSchema>;

export const ProactiveVerdictSchema = z.enum(["accepted", "rejected", "undone"]);
export type ProactiveVerdict = z.infer<typeof ProactiveVerdictSchema>;

export const ProactiveActionSchema = z.object({
  id: z.string().min(1).max(40),
  goalId: z.string().min(1).max(40),
  kind: ProactiveActionKindSchema,
  title: z.string().min(1).max(200),
  instructions: z.string().max(2000),
  trigger: ProactiveTriggerSchema,
  status: ProactiveActionStatusSchema,
  risk: ProactiveRiskSchema.optional(),
  /** Minutes of work it was planned to take, counted against the daily hours budget. */
  minutes: z.number().int().min(1).max(240),
  runId: Id.optional(),
  /** What came of it, in one or two lines. */
  result: z.string().max(1000).optional(),
  verdict: ProactiveVerdictSchema.optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ProactiveAction = z.infer<typeof ProactiveActionSchema>;

export const ProactiveSettingsSchema = z.object({
  enabled: z.boolean(),
  /** IANA zone the quiet hours and the digest hour are read in. */
  timeZone: z.string().min(1).max(64),
  /** Local hours with no pings: from quietStart up to quietEnd (wrapping past midnight). */
  quietStart: z.number().int().min(0).max(23),
  quietEnd: z.number().int().min(0).max(23),
  digestHour: z.number().int().min(0).max(23),
  maxNotificationsPerDay: z.number().int().min(0).max(20),
  dailyActionCap: z.number().int().min(0).max(50),
  /** Hours of proactive work a day, across all goals. */
  hoursBudgetPerDay: z.number().min(0).max(24),
});
export type ProactiveSettings = z.infer<typeof ProactiveSettingsSchema>;

export const ProactiveNotificationSchema = z.object({
  at: IsoDate,
  kind: z.enum(["digest", "approval"]),
});

export const ProactiveStateSchema = z.object({
  settings: ProactiveSettingsSchema,
  actions: z.array(ProactiveActionSchema),
  notifications: z.array(ProactiveNotificationSchema),
  /** The local day of the last digest sent, YYYY-MM-DD. */
  lastDigestDay: z.string().max(10).optional(),
  /** When Gente last read the person's chats for new goals. */
  goalScanAt: IsoDate.optional(),
});
export type ProactiveState = z.infer<typeof ProactiveStateSchema>;

export const GoalMetricsSchema = z.object({
  goalId: z.string(),
  title: z.string(),
  actions: z.number().int(),
  accepted: z.number().int(),
  rejected: z.number().int(),
  undone: z.number().int(),
  acceptanceRate: z.number().nullable(),
  undoRate: z.number().nullable(),
  progress: z.number().int(),
  dial: ProactiveDialSchema,
  /** The dial after Gente's own back-off from rejections and undos. */
  effectiveDial: ProactiveDialSchema,
});
export type GoalMetrics = z.infer<typeof GoalMetricsSchema>;

export const ProactiveMetricsSchema = z.object({
  actions: z.number().int(),
  decided: z.number().int(),
  acceptanceRate: z.number().nullable(),
  undoRate: z.number().nullable(),
  goals: z.array(GoalMetricsSchema),
});
export type ProactiveMetrics = z.infer<typeof ProactiveMetricsSchema>;

export const ProactiveDigestSchema = z.object({
  day: z.string(),
  headline: z.string(),
  items: z.array(ProactiveActionSchema),
  waiting: z.array(ProactiveActionSchema),
});
export type ProactiveDigest = z.infer<typeof ProactiveDigestSchema>;

/** What the goal finder answers from a chat. */
export const GoalExtractOutputSchema = z.object({
  goals: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        outcome: z.string().max(500).catch(""),
      }),
    )
    .max(3)
    .catch([]),
});

/** What the planner answers for one goal. */
export const ProactivePlanOutputSchema = z.object({
  actions: z
    .array(
      z.object({
        kind: ProactiveActionKindSchema.catch("research"),
        title: z.string().trim().min(1).max(200),
        instructions: z.string().trim().max(2000).catch(""),
        minutes: z.number().int().min(1).max(240).catch(15),
      }),
    )
    .max(5)
    .catch([]),
});

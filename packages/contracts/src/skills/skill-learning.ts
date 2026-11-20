// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import * as z from "zod";
import { Id } from "../ids.js";

/** Where a learning came from. Web content waits in quarantine until the person confirms it. */
export const SkillChangeSourceSchema = z.enum(["user_feedback", "web_content", "run_outcome"]);
export type SkillChangeSource = z.infer<typeof SkillChangeSourceSchema>;

export const SkillChangeStatusSchema = z.enum([
  "proposed",
  "testing",
  "live",
  "quarantined",
  "rejected",
  "undone",
]);
export type SkillChangeStatus = z.infer<typeof SkillChangeStatusSchema>;

export const SkillReplayCheckSchema = z.object({
  name: z.string(),
  result: z.enum(["pass", "fail", "unqualified"]),
  note: z.string().optional(),
});

export const SkillReplayReportSchema = z.object({
  passed: z.boolean(),
  rubricVersion: z.string(),
  judged: z.boolean(),
  checks: z.array(SkillReplayCheckSchema),
  ranAt: z.string(),
});

export const SkillGuardViolationSchema = z.object({
  rule: z.enum(["permissions", "spend", "approval"]),
  evidence: z.string(),
});

/** One versioned edit of a skill: the full before and after, their diff, and why. */
export const StoredSkillChangeSchema = z.object({
  id: z.string(),
  /** "learn" is an edit Gente learned; "undo" puts an earlier version back. */
  kind: z.enum(["learn", "undo"]),
  version: z.number().int().positive(),
  before: z.string(),
  after: z.string(),
  diff: z.string(),
  reason: z.string(),
  source: SkillChangeSourceSchema,
  /** For web content: the page it came from. */
  origin: z.string().optional(),
  status: SkillChangeStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  report: SkillReplayReportSchema.optional(),
  violations: z.array(SkillGuardViolationSchema).optional(),
  /** On an undo entry: the change it reverses. */
  reverts: z.string().optional(),
});
export type StoredSkillChange = z.infer<typeof StoredSkillChangeSchema>;

export const StoredSkillExampleSchema = z.object({
  id: z.string(),
  input: z.string(),
  approved: z.string(),
  createdAt: z.string(),
});

/** Everything Gente learned about one skill, kept as one encrypted, revisioned document. */
export const SkillLearningLogSchema = z.object({
  schema: z.literal(1),
  skillId: z.string(),
  skillName: z.string(),
  changes: z.array(StoredSkillChangeSchema),
  examples: z.array(StoredSkillExampleSchema),
});
export type SkillLearningLog = z.infer<typeof SkillLearningLogSchema>;

/** What the "What Gente learned about you" page shows for one change. */
export const LearnedChangeSchema = z.object({
  id: z.string(),
  skillId: Id,
  skillName: z.string(),
  version: z.number().int(),
  reason: z.string(),
  source: SkillChangeSourceSchema,
  origin: z.string().optional(),
  status: SkillChangeStatusSchema,
  diff: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  /** Plain words for why a change did not go live; never an internal error. */
  heldBecause: z.string().optional(),
  canUndo: z.boolean(),
});
export type LearnedChange = z.infer<typeof LearnedChangeSchema>;

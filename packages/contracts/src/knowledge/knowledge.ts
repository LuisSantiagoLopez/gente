// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import * as z from "zod";
import { Id, IsoDate } from "../ids.js";

/**
 * Brains and projects live in the Space's memory documents under their own scopes, so they are
 * encrypted, revisioned and stay on this computer like every other memory. Plain memory screens
 * and the prompt's memory block only read the `bot` and `user` scopes.
 */
export const BRAIN_MEMORY_SCOPE = "brain";
export const PROJECT_MEMORY_SCOPE = "project";
export const PLAIN_MEMORY_SCOPES = ["bot", "user"] as const;

/** Where a fact came from. Every brain fact keeps at least one. */
export const BrainCitationSchema = z.object({
  kind: z.enum(["message", "run", "url", "file", "project", "user"]),
  /** A message, run, project or file id, a full http(s) address, or "you" for a fact the person wrote. */
  ref: z.string().min(1).max(2000),
  label: z.string().max(200).optional(),
});
export type BrainCitation = z.infer<typeof BrainCitationSchema>;

export const BrainFactSchema = z.object({
  text: z.string().min(1).max(600),
  citations: z.array(BrainCitationSchema).min(1).max(8),
  addedAt: IsoDate,
});
export type BrainFact = z.infer<typeof BrainFactSchema>;

export const BrainSchema = z.object({
  slug: z.string().min(1).max(80),
  topic: z.string().min(1).max(120),
  keywords: z.array(z.string().min(1).max(40)).max(24),
  facts: z.array(BrainFactSchema),
  updatedAt: IsoDate,
});
export type Brain = z.infer<typeof BrainSchema>;

export const BrainEntrySchema = BrainSchema.extend({
  id: Id,
  revision: z.number().int(),
  /** The file as stored, for editing by hand. */
  content: z.string(),
});
export type BrainEntry = z.infer<typeof BrainEntrySchema>;

export const ProjectTaskStatusSchema = z.enum(["todo", "doing", "blocked", "done"]);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const ProjectTaskSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  status: ProjectTaskStatusSchema,
  updatedAt: IsoDate,
});
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;

export const ProjectAssetSchema = z.object({
  name: z.string().min(1).max(200),
  artifactId: Id.optional(),
  url: z.string().url().max(2000).optional(),
});
export type ProjectAsset = z.infer<typeof ProjectAssetSchema>;

export const ProjectTimelineEntrySchema = z.object({
  at: IsoDate,
  kind: z.enum(["feedback", "status", "run", "note"]),
  by: z.enum(["user", "bot"]),
  text: z.string().min(1).max(1000),
  runId: Id.optional(),
});
export type ProjectTimelineEntry = z.infer<typeof ProjectTimelineEntrySchema>;

export const ProjectStatusSchema = z.enum(["active", "paused", "done"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  status: ProjectStatusSchema,
  goals: z.array(z.string().min(1).max(300)).max(20),
  tasks: z.array(ProjectTaskSchema).max(200),
  assets: z.array(ProjectAssetSchema).max(200),
  timeline: z.array(ProjectTimelineEntrySchema),
  brainSlugs: z.array(z.string().min(1).max(80)).max(40),
  skillNames: z.array(z.string().min(1).max(80)).max(40),
  /** Chats whose bot works on this project; its runs update it. */
  threadIds: z.array(Id).max(50),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Project = z.infer<typeof ProjectSchema>;

/** What the distiller answers: up to two topics, each fact naming its numbered sources. */
export const BrainDistillOutputSchema = z.object({
  brains: z
    .array(
      z.object({
        topic: z.string().trim().min(1).max(120),
        keywords: z.array(z.string()).max(24).catch([]),
        facts: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(600),
              sources: z.array(z.number().int()).catch([]),
            }),
          )
          .max(24)
          .catch([]),
        replaces: z.array(z.string()).max(24).catch([]),
      }),
    )
    .max(2),
});

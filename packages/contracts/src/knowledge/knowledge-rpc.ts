// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { oc } from "@orpc/contract";
import * as z from "zod";
import { Id } from "../ids.js";
import {
  BrainEntrySchema,
  ProjectAssetSchema,
  ProjectSchema,
  ProjectStatusSchema,
  ProjectTaskStatusSchema,
} from "./knowledge.js";

const ok = z.object({ ok: z.literal(true) });

export const knowledgeRpc = {
  /** Topic knowledge Gente distilled from research and feedback. */
  brains: {
    list: oc.output(z.array(BrainEntrySchema)),
    update: oc
      .input(
        z.object({
          id: Id,
          content: z.string().min(1).max(64_000),
          expectedRevision: z.number().int().positive().optional(),
        }),
      )
      .output(BrainEntrySchema),
    remove: oc.input(z.object({ id: Id })).output(ok),
  },
  projects: {
    list: oc.output(z.array(ProjectSchema)),
    get: oc.input(z.object({ id: z.string().min(1).max(40) })).output(ProjectSchema),
    create: oc
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          goals: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
          threadId: Id.optional(),
        }),
      )
      .output(ProjectSchema),
    update: oc
      .input(
        z.object({
          id: z.string().min(1).max(40),
          name: z.string().trim().min(1).max(120).optional(),
          status: ProjectStatusSchema.optional(),
          goals: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
          addTask: z.string().trim().min(1).max(200).optional(),
          task: z
            .object({ id: z.string().min(1).max(40), status: ProjectTaskStatusSchema })
            .optional(),
          addAsset: ProjectAssetSchema.optional(),
          linkThreadId: Id.optional(),
        }),
      )
      .output(ProjectSchema),
    /** The person's feedback; Gente also distills it into the project's brain. */
    feedback: oc
      .input(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(1000) }))
      .output(ProjectSchema),
    remove: oc.input(z.object({ id: z.string().min(1).max(40) })).output(ok),
  },
};

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { oc } from "@orpc/contract";
import * as z from "zod";
import { IsoDate } from "../ids.js";
import {
  GoalSchema,
  GoalStatusSchema,
  ProactiveActionSchema,
  ProactiveDialSchema,
  ProactiveDigestSchema,
  ProactiveMetricsSchema,
  ProactiveSettingsSchema,
} from "./proactive.js";

const ok = z.object({ ok: z.literal(true) });
const goalId = z.string().min(1).max(40);

export const proactiveRpc = {
  /** What the person is working toward; Gente acts on its own toward each. */
  goals: {
    list: oc.output(z.array(GoalSchema)),
    create: oc
      .input(
        z.object({
          title: z.string().trim().min(1).max(200),
          outcome: z.string().trim().max(500).optional(),
          dial: ProactiveDialSchema.optional(),
          deadline: IsoDate.optional(),
          projectId: z.string().min(1).max(40).optional(),
        }),
      )
      .output(GoalSchema),
    update: oc
      .input(
        z.object({
          id: goalId,
          title: z.string().trim().min(1).max(200).optional(),
          outcome: z.string().trim().max(500).optional(),
          status: GoalStatusSchema.optional(),
          dial: ProactiveDialSchema.optional(),
          progress: z.number().int().min(0).max(100).optional(),
          deadline: IsoDate.nullable().optional(),
          linkProjectId: z.string().min(1).max(40).optional(),
        }),
      )
      .output(GoalSchema),
    remove: oc.input(z.object({ id: goalId })).output(ok),
  },
  proactive: {
    settings: oc.output(ProactiveSettingsSchema),
    updateSettings: oc.input(ProactiveSettingsSchema.partial()).output(ProactiveSettingsSchema),
    /** Today's digest: what Gente did, and what waits for the person. */
    today: oc.output(ProactiveDigestSchema),
    metrics: oc.output(ProactiveMetricsSchema),
    decide: oc
      .input(
        z.object({
          actionId: z.string().min(1).max(40),
          verdict: z.enum(["accepted", "rejected"]),
        }),
      )
      .output(ProactiveActionSchema),
    /** Approve or skip work that waits for the person. */
    approve: oc
      .input(z.object({ actionId: z.string().min(1).max(40), approve: z.boolean() }))
      .output(ProactiveActionSchema),
    undo: oc
      .input(z.object({ actionId: z.string().min(1).max(40) }))
      .output(
        z.object({ action: ProactiveActionSchema, reverted: z.number().int(), note: z.string() }),
      ),
  },
};

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { oc } from "@orpc/contract";
import * as z from "zod";
import { Id } from "../ids.js";
import { LearnedChangeSchema } from "./skill-learning.js";

const ChangeRef = z.object({ skillId: Id, changeId: z.string().min(1).max(100) });

export const skillLearningRpc = {
  learning: {
    /** Newest first, across every skill the person can see. */
    list: oc.output(z.array(LearnedChangeSchema)),
    /** Feedback on how a skill was used; Gente proposes, tests and maybe applies an edit. */
    feedback: oc
      .input(
        z.object({
          skillId: Id,
          /** The bot whose model proposes the edit. */
          botId: Id,
          request: z.string().max(8000),
          reply: z.string().max(16000),
          feedback: z.string().min(1).max(4000),
          /** Set when the lesson came from a web page instead of the person. */
          origin: z.string().url().max(2000).optional(),
        }),
      )
      .output(z.object({ change: LearnedChangeSchema.nullable() })),
    confirm: oc.input(ChangeRef).output(LearnedChangeSchema),
    dismiss: oc.input(ChangeRef).output(LearnedChangeSchema),
    undo: oc.input(ChangeRef).output(LearnedChangeSchema),
  },
};

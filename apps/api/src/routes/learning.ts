// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { RouterContext } from "./context.js";

export function learningRoutes(ctx: RouterContext) {
  const { authed, skillLearning } = ctx;
  return {
    learning: {
      list: authed.learning.list.handler(async ({ context }) => skillLearning.list(context.actor)),
      feedback: authed.learning.feedback.handler(async ({ context, input }) =>
        skillLearning.feedback(context.actor, input),
      ),
      confirm: authed.learning.confirm.handler(async ({ context, input }) =>
        skillLearning.confirm(context.actor, input),
      ),
      dismiss: authed.learning.dismiss.handler(async ({ context, input }) =>
        skillLearning.dismiss(context.actor, input),
      ),
      undo: authed.learning.undo.handler(async ({ context, input }) =>
        skillLearning.undo(context.actor, input),
      ),
    },
  };
}

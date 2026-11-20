// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { runProjectUpdate } from "../../knowledge/project-tool.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** Projects: the bot updates the status of its chat's project on its own. */
export const projectTools: ToolHandlers = {
  async project_update(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(
      await runProjectUpdate(deps, {
        owner: { spaceId: run.spaceId, userId: run.userId },
        threadId: ctx.source.conversationThreadId ?? run.threadId,
        runId: run.id,
        effectKey: call.effectKey,
        args: call.args,
      }),
    );
  },
};

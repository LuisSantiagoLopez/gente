// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { runGoalUpdate } from "../../proactive/goal-tool.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** Goals: the bot records what the person is working toward on its own. */
export const goalToolHandlers: ToolHandlers = {
  async goal_update(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(
      await runGoalUpdate(deps, {
        owner: { spaceId: run.spaceId, userId: run.userId },
        runId: run.id,
        args: call.args,
      }),
    );
  },
};

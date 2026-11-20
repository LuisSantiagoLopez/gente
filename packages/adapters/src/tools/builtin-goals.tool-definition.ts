// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { ConnectorTool } from "@rakazo/adapter-kit";

/** The person's goals: Gente works toward each on its own. */
export const goalTools: ConnectorTool[] = [
  {
    name: "goal_update",
    description:
      "Record a goal the person states for themselves (for example: grow my Etsy sales, land a job, ship my app), or move one forward: progress, status, how proactive to be. Use it on your own when they say what they want or when work moves a goal; no approval is needed. Give title to add one (a goal said again in other words updates the same one), or goalId to change one.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "The goal id from the goals note." },
        title: { type: "string", maxLength: 200, description: "The goal in the person's words." },
        outcome: { type: "string", maxLength: 500, description: "What done looks like." },
        progress: { type: "number", minimum: 0, maximum: 100 },
        status: { type: "string", enum: ["active", "paused", "done"] },
        dial: {
          type: "string",
          enum: ["quiet", "normal", "go_hard"],
          description: "Only when the person asks Your AI to do less or more for this goal.",
        },
        projectId: { type: "string", description: "Link a project that serves this goal." },
      },
    },
  },
];

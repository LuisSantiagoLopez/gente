// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { ConnectorTool } from "@rakazo/adapter-kit";

/** Projects the person keeps with Gente: bots keep their status current on their own. */
export const knowledgeTools: ConnectorTool[] = [
  {
    name: "project_update",
    description:
      "Keep a project current: start one for this chat, add or move tasks, record assets, notes and the person's feedback. Use it on your own whenever work on the project moves; no approval is needed. Without projectId it updates this chat's project. Give name to start a project when this chat has none.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The project id from the projects note." },
        name: { type: "string", maxLength: 120, description: "Start a project with this name." },
        goals: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20 },
        status: { type: "string", enum: ["active", "paused", "done"] },
        addTask: { type: "string", maxLength: 200 },
        taskId: { type: "string", description: "A task id such as t2, with taskStatus." },
        taskStatus: { type: "string", enum: ["todo", "doing", "blocked", "done"] },
        assetName: { type: "string", maxLength: 200 },
        assetUrl: { type: "string", maxLength: 2000 },
        note: { type: "string", maxLength: 1000, description: "What happened, in one line." },
        feedback: {
          type: "string",
          maxLength: 1000,
          description: "The person's feedback, in their words.",
        },
      },
    },
  },
];

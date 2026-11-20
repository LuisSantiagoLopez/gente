// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { randomUUID } from "node:crypto";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { brainDistillJob } from "@rakazo/adapter-kit";
import type { Project, ProjectStatus, ProjectTaskStatus } from "@rakazo/contracts";
import { ProjectStatusSchema, ProjectTaskStatusSchema } from "@rakazo/contracts";
import type { ProjectChange } from "@rakazo/core";
import { applyProjectChange, newProject, ProjectChangeError } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import type { KnowledgeOwner } from "./knowledge-store.js";
import {
  createProjectDocument,
  projectsForThread,
  readProject,
  updateProject,
} from "./knowledge-store.js";

export function newProjectId(): string {
  return `p${randomUUID().replace(/-/g, "").slice(0, 11)}`;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** The change a project_update call asks for, or an error the model can fix and retry. */
export function projectChangeFromArgs(
  args: Record<string, unknown>,
): ProjectChange | { error: string } {
  const change: ProjectChange = {};
  const status = ProjectStatusSchema.safeParse(args.status);
  if (args.status !== undefined && !status.success)
    return { error: "status must be active, paused or done." };
  if (status.success) change.status = status.data as ProjectStatus;
  if (Array.isArray(args.goals))
    change.goals = args.goals.filter((goal): goal is string => typeof goal === "string");
  change.addTask = text(args.addTask, 200);
  const taskId = text(args.taskId, 40);
  if (taskId || args.taskStatus !== undefined) {
    const taskStatus = ProjectTaskStatusSchema.safeParse(args.taskStatus);
    if (!taskId || !taskStatus.success)
      return { error: "Give taskId with taskStatus todo, doing, blocked or done." };
    change.task = { id: taskId, status: taskStatus.data as ProjectTaskStatus };
  }
  const assetName = text(args.assetName, 200);
  const assetUrl = text(args.assetUrl, 2000);
  if (assetUrl && !/^https?:\/\//i.test(assetUrl))
    return { error: "assetUrl must be an http or https address." };
  if (assetName || assetUrl)
    change.addAsset = { name: assetName ?? assetUrl!, ...(assetUrl ? { url: assetUrl } : {}) };
  change.note = text(args.note, 1000);
  change.feedback = text(args.feedback, 1000);
  return change;
}

function summary(project: Project) {
  return {
    projectId: project.id,
    name: project.name,
    status: project.status,
    tasks: project.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  };
}

/**
 * project_update: a bot keeps its chat's project current without asking. It acts only on the
 * run owner's projects in the run's Space; feedback it records is queued for the project's brain.
 */
export async function runProjectUpdate(
  deps: {
    prisma: PrismaClient;
    jobs: JobPublisher;
    events?: Pick<ThreadEvents, "publishSpaceChange">;
  },
  input: {
    owner: KnowledgeOwner;
    threadId: string;
    runId: string;
    effectKey: string;
    args: Record<string, unknown>;
  },
): Promise<unknown> {
  const change = projectChangeFromArgs(input.args);
  if ("error" in change) return { error: change.error };
  change.runId = input.runId;
  change.linkThreadId = input.threadId;
  const now = new Date().toISOString();
  const projectId = text(input.args.projectId, 40);
  let target: Project | null = projectId
    ? await readProject(deps.prisma, input.owner, projectId)
    : null;
  if (projectId && !target)
    return { error: `No project ${projectId}. Leave projectId out to use this chat's project.` };
  if (!target) {
    const linked = await projectsForThread(deps.prisma, input.owner, input.threadId);
    target = linked.find((project) => project.status === "active") ?? linked[0] ?? null;
  }
  if (!target) {
    const name = text(input.args.name, 120);
    if (!name) return { error: "This chat has no project yet. Give name to start one." };
    const goals = Array.isArray(input.args.goals)
      ? input.args.goals.filter((goal): goal is string => typeof goal === "string")
      : [];
    target = await createProjectDocument(
      deps.prisma,
      input.owner,
      newProject({ id: newProjectId(), name, goals, threadId: input.threadId, now }),
    );
  }
  let updated: Project;
  try {
    updated = await updateProject(
      deps.prisma,
      input.owner,
      target.id,
      (current) => applyProjectChange(current, change, "bot", now),
      { sourceRunId: input.runId },
    );
  } catch (error) {
    if (error instanceof ProjectChangeError) return { error: error.message };
    throw error;
  }
  await deps.events?.publishSpaceChange?.(input.owner.spaceId, "knowledge");
  if (change.feedback) {
    await deps.jobs.enqueue(
      brainDistillJob(
        { ...input.owner, projectId: updated.id, feedback: change.feedback },
        `${updated.id}:${input.effectKey}`,
      ),
    );
  }
  return summary(updated);
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { JobPublisher } from "@rakazo/adapter-kit";
import { brainDistillJob } from "@rakazo/adapter-kit";
import { recordProjectRun } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { projectsForThread, updateProject } from "./knowledge-store.js";

/**
 * After a run finishes: the projects its chat works on get a timeline line saying what it did,
 * and a run that read the web or other outside sources is queued for distilling into brains.
 */
export async function recordRunKnowledge(
  deps: {
    prisma: PrismaClient;
    jobs: JobPublisher;
    events?: Pick<ThreadEvents, "publishSpaceChange">;
  },
  input: {
    spaceId: string;
    userId: string;
    runId: string;
    threadId: string;
    researched: boolean;
    summary: string;
  },
): Promise<void> {
  const owner = { spaceId: input.spaceId, userId: input.userId };
  const projects = (await projectsForThread(deps.prisma, owner, input.threadId)).filter(
    (project) => project.status === "active",
  );
  const now = new Date().toISOString();
  for (const project of projects) {
    await updateProject(deps.prisma, owner, project.id, (current) =>
      recordProjectRun(current, input.runId, input.summary, now),
    );
  }
  if (projects.length) await deps.events?.publishSpaceChange?.(input.spaceId, "knowledge");
  if (!input.researched) return;
  await deps.jobs.enqueue(
    brainDistillJob(
      { ...owner, runId: input.runId, ...(projects[0] ? { projectId: projects[0].id } : {}) },
      input.runId,
    ),
  );
}

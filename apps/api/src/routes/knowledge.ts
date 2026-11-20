// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

import { brainDistillJob } from "@rakazo/adapter-kit";
import {
  createProjectDocument,
  editBrain,
  listBrains,
  listProjects,
  newProjectId,
  projectDocumentId,
  readProject,
  removeKnowledgeDocument,
  updateProject,
} from "@rakazo/adapters";
import { BRAIN_MEMORY_SCOPE, PROJECT_MEMORY_SCOPE } from "@rakazo/contracts";
import { applyProjectChange, ClientError, newProject } from "@rakazo/core";
import type { RouterContext } from "./context.js";

/** Brains and projects: the person's own, in the actor's Space, kept on this computer. */
export function knowledgeRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const owner = (actor: { spaceId: string; userId: string }) => ({
    spaceId: actor.spaceId,
    userId: actor.userId,
  });
  return {
    brains: {
      list: authed.brains.list.handler(({ context }) =>
        listBrains(deps.prisma, owner(context.actor)),
      ),
      update: authed.brains.update.handler(({ context, input }) =>
        editBrain(deps.prisma, owner(context.actor), input),
      ),
      remove: authed.brains.remove.handler(async ({ context, input }) => {
        await removeKnowledgeDocument(
          deps.prisma,
          owner(context.actor),
          input.id,
          BRAIN_MEMORY_SCOPE,
        );
        return { ok: true as const };
      }),
    },
    projects: {
      list: authed.projects.list.handler(({ context }) =>
        listProjects(deps.prisma, owner(context.actor)),
      ),
      get: authed.projects.get.handler(async ({ context, input }) => {
        const project = await readProject(deps.prisma, owner(context.actor), input.id);
        if (!project)
          throw new ClientError(
            "NOT_FOUND",
            "That project is no longer here.",
            "project_not_found",
          );
        return project;
      }),
      create: authed.projects.create.handler(async ({ context, input }) => {
        if (input.threadId) {
          const thread = await deps.prisma.thread.findFirst({
            where: { id: input.threadId, spaceId: context.actor.spaceId },
            select: { id: true },
          });
          if (!thread)
            throw new ClientError("NOT_FOUND", "That chat is no longer here.", "thread_not_found");
        }
        return createProjectDocument(
          deps.prisma,
          owner(context.actor),
          newProject({ id: newProjectId(), ...input, now: new Date().toISOString() }),
        );
      }),
      update: authed.projects.update.handler(async ({ context, input }) => {
        const { id, linkThreadId, ...change } = input;
        if (linkThreadId) {
          const thread = await deps.prisma.thread.findFirst({
            where: { id: linkThreadId, spaceId: context.actor.spaceId },
            select: { id: true },
          });
          if (!thread)
            throw new ClientError("NOT_FOUND", "That chat is no longer here.", "thread_not_found");
        }
        const now = new Date().toISOString();
        return updateProject(deps.prisma, owner(context.actor), id, (project) =>
          applyProjectChange(project, { ...change, linkThreadId }, "user", now),
        );
      }),
      feedback: authed.projects.feedback.handler(async ({ context, input }) => {
        const now = new Date().toISOString();
        const project = await updateProject(
          deps.prisma,
          owner(context.actor),
          input.id,
          (current) => applyProjectChange(current, { feedback: input.text }, "user", now),
        );
        // Each round of feedback is distilled into the project's brain in the background.
        await deps.jobs.enqueue(
          brainDistillJob(
            { ...owner(context.actor), projectId: project.id, feedback: input.text },
            `${project.id}:${project.timeline.length}`,
          ),
        );
        return project;
      }),
      remove: authed.projects.remove.handler(async ({ context, input }) => {
        const id = await projectDocumentId(deps.prisma, owner(context.actor), input.id);
        if (id)
          await removeKnowledgeDocument(
            deps.prisma,
            owner(context.actor),
            id,
            PROJECT_MEMORY_SCOPE,
          );
        return { ok: true as const };
      }),
    },
  };
}

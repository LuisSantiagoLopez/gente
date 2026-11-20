// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { matchBrains } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { formatActiveProjects, formatBrainContext } from "./knowledge-context.prompt.js";
import type { KnowledgeOwner } from "./knowledge-store.js";
import { listBrains, projectsForThread } from "./knowledge-store.js";

/**
 * What a turn learns from brains and projects: the brains its message is about (and those its
 * chat's project links), and the project it works on. Both stay empty when there are none.
 */
export async function loadKnowledgeContext(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  input: { prompt: string; threadId: string },
): Promise<{ brains: string; projects: string }> {
  const [brains, projects] = await Promise.all([
    listBrains(prisma, owner),
    projectsForThread(prisma, owner, input.threadId),
  ]);
  const active = projects.filter((project) => project.status !== "done");
  const matched = matchBrains(input.prompt, brains, {
    extraSlugs: active.flatMap((project) => project.brainSlugs),
  });
  return { brains: formatBrainContext(matched), projects: formatActiveProjects(active) };
}

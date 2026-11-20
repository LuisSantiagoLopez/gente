// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { BRAIN_MEMORY_SCOPE, GOAL_MEMORY_SCOPE, PROJECT_MEMORY_SCOPE } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { KnowledgeOwner } from "../knowledge/knowledge-store.js";
import { saveDocument } from "../knowledge/knowledge-store.js";

/** What an undo can put back: Gente's own notes on the person's projects, brains and goals. */
const UNDOABLE_SCOPES = [BRAIN_MEMORY_SCOPE, PROJECT_MEMORY_SCOPE, GOAL_MEMORY_SCOPE];

/**
 * Puts back every project, brain and goal a run changed, as they were before it: a document the
 * run created is removed, and one it edited gets its earlier text back as a new revision (so the
 * undo itself can be undone from history). A later edit by someone else is kept only if it came
 * after; this restores the version just before the run's first change.
 */
export async function revertRunChanges(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  runId: string,
): Promise<number> {
  const revisions = await prisma.memoryRevision.findMany({
    where: {
      sourceRunId: runId,
      document: { spaceId: owner.spaceId, botId: null, scope: { in: UNDOABLE_SCOPES } },
    },
    orderBy: { revision: "asc" },
    select: {
      revision: true,
      document: { select: { id: true, scope: true, path: true } },
    },
  });
  const firstByDocument = new Map<string, (typeof revisions)[number]>();
  for (const revision of revisions)
    if (!firstByDocument.has(revision.document.id))
      firstByDocument.set(revision.document.id, revision);
  let reverted = 0;
  for (const first of firstByDocument.values()) {
    const { document } = first;
    if (first.revision <= 1) {
      await prisma.memoryDocument.deleteMany({
        where: { id: document.id, spaceId: owner.spaceId },
      });
      reverted += 1;
      continue;
    }
    const before = await prisma.memoryRevision.findUnique({
      where: { documentId_revision: { documentId: document.id, revision: first.revision - 1 } },
      select: { content: true },
    });
    if (!before) continue;
    await saveDocument(prisma, owner, {
      scope: document.scope,
      path: document.path,
      content: before.content,
    });
    reverted += 1;
  }
  return reverted;
}

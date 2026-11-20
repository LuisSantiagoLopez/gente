// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Brain, BrainEntry, Project } from "@rakazo/contracts";
import { BRAIN_MEMORY_SCOPE, PROJECT_MEMORY_SCOPE } from "@rakazo/contracts";
import {
  BRAIN_PATH_PREFIX,
  brainPath,
  ClientError,
  PROJECT_PATH_PREFIX,
  parseBrain,
  parseProject,
  projectPath,
  retry,
  serializeBrain,
  serializeProject,
  slugFromBrainPath,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { Prisma, withTransactionRetry } from "@rakazo/db";

/**
 * Brains and projects are Space memory documents under their own scopes: encrypted at rest,
 * every save kept as a revision, all in the local database. Nothing here leaves the computer.
 */
export interface KnowledgeOwner {
  spaceId: string;
  userId: string;
}

type DocumentRow = { id: string; path: string; content: string; revision: number; updatedAt: Date };

export function brainEntry(row: DocumentRow): BrainEntry | null {
  const slug = slugFromBrainPath(row.path);
  if (!slug) return null;
  const brain = parseBrain(row.content, { slug, now: row.updatedAt.toISOString() });
  return { ...brain, id: row.id, revision: row.revision, content: row.content };
}

export async function listBrains(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
): Promise<BrainEntry[]> {
  const rows = await prisma.memoryDocument.findMany({
    where: {
      spaceId: owner.spaceId,
      scope: BRAIN_MEMORY_SCOPE,
      botId: null,
      path: { startsWith: BRAIN_PATH_PREFIX },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, path: true, content: true, revision: true, updatedAt: true },
  });
  return rows.flatMap((row) => brainEntry(row) ?? []);
}

export async function readBrain(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  slug: string,
): Promise<BrainEntry | null> {
  const row = await prisma.memoryDocument.findFirst({
    where: {
      spaceId: owner.spaceId,
      scope: BRAIN_MEMORY_SCOPE,
      botId: null,
      path: brainPath(slug),
    },
    select: { id: true, path: true, content: true, revision: true, updatedAt: true },
  });
  return row ? brainEntry(row) : null;
}

export class KnowledgeConflictError extends ClientError {
  constructor() {
    super(
      "CONFLICT",
      "This changed while you were editing. Open it again to see the latest.",
      "knowledge_conflict",
    );
    this.name = "KnowledgeConflictError";
  }
}

/** Saves one document and appends its revision atomically, as plain memory saves do. */
async function saveDocument(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  input: {
    scope: string;
    path: string;
    content: string;
    expectedRevision?: number;
    sourceRunId?: string;
  },
): Promise<DocumentRow> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.memoryDocument.findFirst({
          where: { spaceId: owner.spaceId, scope: input.scope, botId: null, path: input.path },
        });
        if (
          input.expectedRevision !== undefined &&
          (existing?.revision ?? 0) !== input.expectedRevision
        ) {
          throw new KnowledgeConflictError();
        }
        const doc = existing
          ? await tx.memoryDocument.update({
              where: { id: existing.id },
              data: { content: input.content, revision: existing.revision + 1 },
            })
          : await tx.memoryDocument.create({
              data: {
                spaceId: owner.spaceId,
                userId: owner.userId,
                scope: input.scope,
                path: input.path,
                content: input.content,
              },
            });
        await tx.memoryRevision.create({
          data: {
            documentId: doc.id,
            revision: doc.revision,
            content: input.content,
            sourceRunId: input.sourceRunId,
          },
        });
        return {
          id: doc.id,
          path: doc.path,
          content: input.content,
          revision: doc.revision,
          updatedAt: doc.updatedAt,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function saveBrain(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  brain: Brain,
  options: { sourceRunId?: string } = {},
): Promise<BrainEntry> {
  const row = await saveDocument(prisma, owner, {
    scope: BRAIN_MEMORY_SCOPE,
    path: brainPath(brain.slug),
    content: serializeBrain(brain),
    ...options,
  });
  return brainEntry(row)!;
}

async function ownedDocument(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
  scope: string,
) {
  const row = await prisma.memoryDocument.findFirst({
    where: { id, spaceId: owner.spaceId, scope, botId: null },
    select: { id: true, path: true, content: true, revision: true, updatedAt: true },
  });
  if (!row) throw new ClientError("NOT_FOUND", "That's no longer here.", "knowledge_not_found");
  return row;
}

/** A person's edit to a brain file, saved as they wrote it once it still reads as a brain. */
export async function editBrain(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  input: { id: string; content: string; expectedRevision?: number },
): Promise<BrainEntry> {
  const row = await ownedDocument(prisma, owner, input.id, BRAIN_MEMORY_SCOPE);
  const slug = slugFromBrainPath(row.path)!;
  // Normalised, so every fact keeps a numbered source and the file stays readable by Gente.
  const brain = parseBrain(input.content, { slug, now: new Date().toISOString() });
  const saved = await saveDocument(prisma, owner, {
    scope: BRAIN_MEMORY_SCOPE,
    path: row.path,
    content: serializeBrain({ ...brain, updatedAt: new Date().toISOString() }),
    expectedRevision: input.expectedRevision,
  });
  return brainEntry(saved)!;
}

export async function removeKnowledgeDocument(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
  scope: typeof BRAIN_MEMORY_SCOPE | typeof PROJECT_MEMORY_SCOPE,
): Promise<void> {
  // Revisions cascade with the document, so deleting removes every saved version too.
  await prisma.memoryDocument.deleteMany({
    where: { id, spaceId: owner.spaceId, scope, botId: null },
  });
}

export async function listProjects(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
): Promise<Project[]> {
  const rows = await prisma.memoryDocument.findMany({
    where: {
      spaceId: owner.spaceId,
      scope: PROJECT_MEMORY_SCOPE,
      botId: null,
      path: { startsWith: PROJECT_PATH_PREFIX },
    },
    orderBy: { updatedAt: "desc" },
    select: { content: true },
  });
  return rows.flatMap((row) => parseProject(row.content) ?? []);
}

export async function readProject(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
): Promise<Project | null> {
  const row = await prisma.memoryDocument.findFirst({
    where: {
      spaceId: owner.spaceId,
      scope: PROJECT_MEMORY_SCOPE,
      botId: null,
      path: projectPath(id),
    },
    select: { content: true },
  });
  return row ? parseProject(row.content) : null;
}

export async function projectDocumentId(prisma: PrismaClient, owner: KnowledgeOwner, id: string) {
  const row = await prisma.memoryDocument.findFirst({
    where: {
      spaceId: owner.spaceId,
      scope: PROJECT_MEMORY_SCOPE,
      botId: null,
      path: projectPath(id),
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** The projects a chat works on; its runs update them. */
export async function projectsForThread(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  threadId: string,
) {
  return (await listProjects(prisma, owner)).filter((project) =>
    project.threadIds.includes(threadId),
  );
}

/**
 * Reads, changes and saves a project as one step: a save that lost a race reads again and
 * reapplies the change, so a bot and the person can update the same project at once.
 */
export async function updateProject(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  id: string,
  change: (project: Project) => Project,
  options: { sourceRunId?: string } = {},
): Promise<Project> {
  return retry(
    async () => {
      const row = await prisma.memoryDocument.findFirst({
        where: {
          spaceId: owner.spaceId,
          scope: PROJECT_MEMORY_SCOPE,
          botId: null,
          path: projectPath(id),
        },
        select: { content: true, revision: true },
      });
      const project = row ? parseProject(row.content) : null;
      if (!row || !project)
        throw new ClientError("NOT_FOUND", "That project is no longer here.", "project_not_found");
      const next = change(project);
      if (next === project) return project;
      await saveDocument(prisma, owner, {
        scope: PROJECT_MEMORY_SCOPE,
        path: projectPath(id),
        content: serializeProject(next),
        expectedRevision: row.revision,
        ...options,
      });
      return next;
    },
    { attempts: 5, delayMs: 0, retryable: (error) => error instanceof KnowledgeConflictError },
  );
}

export async function createProjectDocument(
  prisma: PrismaClient,
  owner: KnowledgeOwner,
  project: Project,
): Promise<Project> {
  await saveDocument(prisma, owner, {
    scope: PROJECT_MEMORY_SCOPE,
    path: projectPath(project.id),
    content: serializeProject(project),
    expectedRevision: 0,
  });
  return project;
}

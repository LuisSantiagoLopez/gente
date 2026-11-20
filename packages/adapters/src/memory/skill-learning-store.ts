// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { SkillLearningLog } from "@rakazo/contracts";
import { SkillLearningLogSchema } from "@rakazo/contracts";
import { ClientError, emptySkillLearningLog } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/**
 * Memory documents of this scope hold one skill's learning log each: encrypted at rest and
 * revisioned like any memory document, but never loaded into a run's prompt.
 */
export const LEARNED_SKILL_SCOPE = "learned-skill";

const logPath = (skillId: string) => `skills/${skillId}.json`;

type Owner = { spaceId: string; userId: string };
type Db = Pick<PrismaClient, "memoryDocument" | "memoryRevision" | "$transaction">;

export type ReadSkillLearningLog = {
  log: SkillLearningLog;
  revision: number;
  docId?: string;
};

export async function readSkillLearningLog(
  prisma: Db,
  owner: Owner,
  skill: { id: string; name: string },
): Promise<ReadSkillLearningLog> {
  const doc = await prisma.memoryDocument.findFirst({
    where: {
      spaceId: owner.spaceId,
      scope: LEARNED_SKILL_SCOPE,
      botId: null,
      path: logPath(skill.id),
    },
  });
  const parsed = doc ? parseSkillLearningLog(doc.content, doc.id) : null;
  return {
    log: parsed ?? emptySkillLearningLog(skill),
    revision: doc?.revision ?? 0,
    docId: doc?.id,
  };
}

/** Every readable log in the space. A log that no longer parses is reported and left out. */
export async function listSkillLearningLogs(prisma: Db, owner: Owner) {
  const docs = await prisma.memoryDocument.findMany({
    where: { spaceId: owner.spaceId, scope: LEARNED_SKILL_SCOPE, botId: null },
  });
  return docs.flatMap((doc) => parseSkillLearningLog(doc.content, doc.id) ?? []);
}

/** Saves only if nobody saved since `read`; each save is also kept as a revision. */
export async function writeSkillLearningLog(
  prisma: Db,
  owner: Owner,
  log: SkillLearningLog,
  read: Pick<ReadSkillLearningLog, "revision" | "docId">,
): Promise<void> {
  const content = JSON.stringify(log);
  await prisma.$transaction(async (tx) => {
    if (read.docId) {
      const updated = await tx.memoryDocument.updateMany({
        where: { id: read.docId, revision: read.revision },
        data: { content, revision: read.revision + 1 },
      });
      if (updated.count === 0)
        throw new ClientError("CONFLICT", "Something else changed this skill. Try again.");
      await tx.memoryRevision.create({
        data: { documentId: read.docId, revision: read.revision + 1, content },
      });
      return;
    }
    const created = await tx.memoryDocument.create({
      data: {
        spaceId: owner.spaceId,
        userId: owner.userId,
        scope: LEARNED_SKILL_SCOPE,
        path: logPath(log.skillId),
        content,
      },
    });
    await tx.memoryRevision.create({ data: { documentId: created.id, revision: 1, content } });
  });
}

function parseSkillLearningLog(content: string, docId: string): SkillLearningLog | null {
  try {
    const parsed = SkillLearningLogSchema.safeParse(JSON.parse(content));
    if (parsed.success) return parsed.data;
  } catch {
    // Reported below with the document id; the row is left out, never guessed.
  }
  getLogger().warn("skill learning log unreadable", { "memory.document.id": docId });
  return null;
}

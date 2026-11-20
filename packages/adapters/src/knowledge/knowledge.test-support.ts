// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { PrismaClient } from "@rakazo/db";

type Doc = {
  id: string;
  spaceId: string;
  userId: string;
  botId: string | null;
  scope: string;
  path: string;
  content: string;
  revision: number;
  updatedAt: Date;
};

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as Record<string, unknown>;
      if ("startsWith" in c)
        return typeof value === "string" && value.startsWith(String(c.startsWith));
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("not" in c) return value !== c.not;
    }
    return value === condition;
  });
}

/** The memory, run, message and thread reads the knowledge code makes, kept in memory. */
export function fakeKnowledgePrisma(
  seed: {
    runs?: Array<{ id: string; threadId: string; botId: string; sourceMessageId?: string | null }>;
    messages?: Array<{
      id: string;
      threadId: string;
      runId?: string;
      role: string;
      seq: number;
      blocks: unknown;
      toolHistory?: string | null;
    }>;
    threads?: Array<{ id: string; spaceId: string; botId: string | null; createdAt?: Date }>;
  } = {},
) {
  const docs: Doc[] = [];
  const revisions: Array<{
    documentId: string;
    revision: number;
    content: string;
    sourceRunId?: string;
  }> = [];
  let next = 0;
  const pick = (row: Doc) => ({ ...row });
  const memoryDocument = {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      docs
        .filter((doc) => matches(doc, where))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(pick),
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const doc = docs.find((row) => matches(row, where));
      return doc ? pick(doc) : null;
    },
    create: async ({
      data,
    }: {
      data: Omit<Doc, "id" | "revision" | "updatedAt" | "botId"> & { botId?: string | null };
    }) => {
      next += 1;
      const doc: Doc = {
        botId: null,
        ...data,
        id: `doc${next}`,
        revision: 1,
        updatedAt: new Date(Date.now() + next),
      };
      docs.push(doc);
      return pick(doc);
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { content: string; revision: number };
    }) => {
      const doc = docs.find((row) => row.id === where.id)!;
      next += 1;
      Object.assign(doc, data, { updatedAt: new Date(Date.now() + next) });
      return pick(doc);
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i -= 1) if (matches(docs[i]!, where)) docs.splice(i, 1);
      return { count: before - docs.length };
    },
  };
  const prisma = {
    memoryDocument,
    memoryRevision: {
      create: async ({ data }: { data: (typeof revisions)[number] }) => {
        revisions.push(data);
        return data;
      },
    },
    run: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        (seed.runs ?? []).find((run) => run.id === where.id) ?? null,
    },
    message: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        (seed.messages ?? [])
          .filter((message) => matches(message, where))
          .sort((a, b) => a.seq - b.seq),
      findUnique: async ({ where }: { where: { id: string } }) =>
        (seed.messages ?? []).find((message) => message.id === where.id) ?? null,
    },
    thread: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        (seed.threads ?? []).find((thread) => matches(thread, where)) ?? null,
    },
    deploymentSettings: { findUnique: async () => null },
    usageEvent: {},
    $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(prisma),
  };
  return { prisma: prisma as unknown as PrismaClient, docs, revisions };
}

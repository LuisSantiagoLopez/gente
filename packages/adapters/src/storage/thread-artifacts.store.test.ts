// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Small text attachments read through the real artifact store on disk (sealed, like the app),
// not a mock: the bytes live under the row's storage key, which differs from the row id.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import type { DataKey, PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactKeys } from "./artifacts.js";
import { LocalArtifactStore } from "./artifacts.js";
import { readSmallTextTurnFiles } from "./thread-artifacts.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const context: AdapterContext = {
  spaceId: "space-1",
  userId: "user-1",
  operationId: "test",
  traceId: "test",
  signal: new AbortController().signal,
};

function keys(): ArtifactKeys {
  const rows = new Map<string, DataKey>();
  return {
    encryptWrites: true,
    async current(spaceId) {
      const id = `key-${spaceId}`;
      if (!rows.has(id)) rows.set(id, { id, spaceId, version: 1, key: randomBytes(32) } as DataKey);
      return rows.get(id)!;
    },
    async byId(id) {
      const key = rows.get(id);
      if (!key) throw new Error("Unknown key");
      return key;
    },
  };
}

describe("small text attachments through the real artifact store", () => {
  it("reads each file by its storage key and skips one whose bytes are gone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gente-artifacts-"));
    dirs.push(root);
    const store = new LocalArtifactStore(root, keys());
    const csv = Buffer.from("date,amount\n2026-10-01,5");
    const saved = await store.put({ bytes: csv, name: "bank.csv", mimeType: "text/csv" }, context);
    const rows = [
      // The row id is the database id; the bytes are stored under storageKey.
      {
        id: randomUUID(),
        storageKey: saved.id,
        name: "bank.csv",
        mimeType: "text/csv",
        size: csv.length,
      },
      {
        id: randomUUID(),
        storageKey: randomUUID(),
        name: "lost.md",
        mimeType: "text/markdown",
        size: 10,
      },
    ];
    const prisma = {
      artifact: {
        findMany: async ({ where }: { where: { id: { in: string[] }; spaceId: string } }) =>
          rows.filter((row) => where.id.in.includes(row.id)),
      },
    } as unknown as PrismaClient;
    const blocks = rows.map((row) => ({
      kind: "file",
      artifactId: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
    })) as unknown as MessageBlock[];

    const files = await readSmallTextTurnFiles({ prisma, artifacts: store }, blocks, context);

    expect(files).toEqual([
      {
        name: "bank.csv",
        path: `attachments/${rows[0]!.id}.csv`,
        text: "date,amount\n2026-10-01,5",
      },
    ]);
  });
});

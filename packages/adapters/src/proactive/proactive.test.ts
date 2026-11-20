// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { GOAL_MEMORY_SCOPE, PROJECT_MEMORY_SCOPE } from "@rakazo/contracts";
import { decideAction, emptyProactiveState } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { fakeKnowledgePrisma } from "../knowledge/knowledge.test-support.js";
import { runGoalUpdate } from "./goal-tool.js";
import {
  isProactiveRun,
  PROACTIVE_NONCE_PREFIX,
  parseExtractedGoals,
  parsePlannedActions,
} from "./proactive-runtime.js";
import { listGoals, loadProactiveState, updateProactiveState } from "./proactive-store.js";
import { revertRunChanges } from "./proactive-undo.js";

const owner = { spaceId: "s1", userId: "u1" };

describe("goal_update", () => {
  it("adds a goal, updates it when said again, and refuses bad input", async () => {
    const { prisma, docs } = fakeKnowledgePrisma();
    const added = (await runGoalUpdate(
      { prisma },
      { owner, runId: "r1", args: { title: "Grow my Etsy sales", outcome: "$2k a month" } },
    )) as { goalId: string; added: boolean };
    expect(added.added).toBe(true);
    expect(docs[0]).toMatchObject({ scope: GOAL_MEMORY_SCOPE, spaceId: "s1" });
    const again = await runGoalUpdate(
      { prisma },
      { owner, runId: "r2", args: { title: "grow Etsy sales", progress: 30 } },
    );
    expect(again).toMatchObject({ goalId: added.goalId, progress: 30 });
    expect(await listGoals(prisma, owner)).toHaveLength(1);
    expect(await runGoalUpdate({ prisma }, { owner, runId: "r3", args: { dial: "loud" } })).toEqual(
      { error: "dial must be quiet, normal or go_hard." },
    );
    expect(await runGoalUpdate({ prisma }, { owner, runId: "r3", args: {} })).toEqual({
      error: "Give title to add a goal, or goalId to change one.",
    });
    // Another person's Space never sees it.
    expect(await listGoals(prisma, { spaceId: "s2", userId: "u2" })).toEqual([]);
  });
});

describe("proactive state", () => {
  it("starts with defaults in the person's time zone and saves changes", async () => {
    const { prisma } = fakeKnowledgePrisma();
    const fresh = await loadProactiveState(prisma, owner, { timeZone: "Europe/Madrid" });
    expect(fresh.settings).toMatchObject({ timeZone: "Europe/Madrid", enabled: true });
    await updateProactiveState(prisma, owner, (state) => ({
      ...state,
      settings: { ...state.settings, maxNotificationsPerDay: 1 },
    }));
    expect((await loadProactiveState(prisma, owner)).settings.maxNotificationsPerDay).toBe(1);
  });
});

describe("model answers", () => {
  it("reads plans and goals from JSON, and nothing from anything else", () => {
    expect(
      parsePlannedActions(
        'Sure! {"actions":[{"kind":"draft","title":"Draft a cover letter","instructions":"Save it","minutes":20}]}',
      ),
    ).toEqual([
      { kind: "draft", title: "Draft a cover letter", instructions: "Save it", minutes: 20 },
    ]);
    expect(parsePlannedActions("no plan")).toEqual([]);
    expect(parseExtractedGoals('{"goals":[{"title":"Land a job"}]}')).toEqual([
      { title: "Land a job", outcome: "" },
    ]);
  });

  it("knows its own runs by their nonce", () => {
    expect(
      isProactiveRun({ trigger: "routine", clientNonce: `${PROACTIVE_NONCE_PREFIX}:x1` }),
    ).toBe(true);
    expect(isProactiveRun({ trigger: "user", clientNonce: `${PROACTIVE_NONCE_PREFIX}:x1` })).toBe(
      false,
    );
    expect(isProactiveRun({ trigger: "routine", clientNonce: "strategic-initiative:b:1" })).toBe(
      false,
    );
  });
});

describe("undo", () => {
  it("puts back what a run changed: removes what it created, restores what it edited", async () => {
    const fake = fakeKnowledgePrisma();
    const { prisma, docs, revisions } = fake;
    const now = new Date();
    docs.push(
      {
        id: "d1",
        spaceId: "s1",
        userId: "u1",
        botId: null,
        scope: PROJECT_MEMORY_SCOPE,
        path: "projects/p1.json",
        content: "edited by run",
        revision: 2,
        updatedAt: now,
      },
      {
        id: "d2",
        spaceId: "s1",
        userId: "u1",
        botId: null,
        scope: GOAL_MEMORY_SCOPE,
        path: "goals/g9.json",
        content: "created by run",
        revision: 1,
        updatedAt: now,
      },
    );
    revisions.push(
      { documentId: "d1", revision: 1, content: "before the run" },
      { documentId: "d1", revision: 2, content: "edited by run", sourceRunId: "r1" },
      { documentId: "d2", revision: 1, content: "created by run", sourceRunId: "r1" },
    );
    const withDocument = (revision: (typeof revisions)[number]) => {
      const doc = docs.find((row) => row.id === revision.documentId);
      return doc ? { ...revision, document: doc } : null;
    };
    Object.assign(prisma.memoryRevision, {
      findMany: async ({ where }: { where: { sourceRunId: string } }) =>
        revisions
          .filter((revision) => revision.sourceRunId === where.sourceRunId)
          .flatMap((revision) => withDocument(revision) ?? []),
      findUnique: async ({
        where,
      }: {
        where: { documentId_revision: { documentId: string; revision: number } };
      }) =>
        revisions.find(
          (revision) =>
            revision.documentId === where.documentId_revision.documentId &&
            revision.revision === where.documentId_revision.revision,
        ) ?? null,
    });
    expect(await revertRunChanges(prisma, owner, "r1")).toBe(2);
    expect(docs.find((doc) => doc.id === "d1")?.content).toBe("before the run");
    expect(docs.find((doc) => doc.id === "d2")).toBeUndefined();
    // Undo counts as the person's answer, so the dial learns from it.
    const state = decideAction(
      {
        ...emptyProactiveState(),
        actions: [
          {
            id: "a1",
            goalId: "g1",
            kind: "update",
            title: "t",
            instructions: "",
            trigger: "schedule",
            status: "done",
            minutes: 5,
            runId: "r1",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ],
      },
      "a1",
      "undone",
      now.toISOString(),
    );
    expect(state.actions[0]?.verdict).toBe("undone");
  });
});

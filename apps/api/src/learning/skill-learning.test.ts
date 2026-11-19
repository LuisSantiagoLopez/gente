import { LEARNED_SKILL_SCOPE } from "@rakazo/adapters";
import type { Actor, AgentSkill } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { createSkillLearningService } from "./skill-learning.js";
import type { SkillLearningModel } from "./skill-learning-model.js";
import { parseModelJson } from "./skill-learning-model.js";

const actor = { userId: "user1", spaceId: "space1" } as Actor;
const V1 = "---\nname: weekly-report\ndescription: Weekly report\n---\n1. Three bullets.\n";
const V2 =
  "---\nname: weekly-report\ndescription: Weekly report\n---\n1. Three bullets.\n2. Warm tone.\n";

type Doc = {
  id: string;
  spaceId: string;
  scope: string;
  botId: null;
  path: string;
  content: string;
  revision: number;
};

function fakes(options: { readOnly?: boolean } = {}) {
  const docs: Doc[] = [];
  const revisions: Array<{ documentId: string; revision: number }> = [];
  const skill: AgentSkill = {
    id: "skill1",
    name: "weekly-report",
    description: "Weekly report",
    content: V1,
    source: options.readOnly ? "builtin" : "user",
    readOnly: Boolean(options.readOnly),
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  };
  const match = (doc: Doc, where: Partial<Doc>) =>
    Object.entries(where).every(([key, value]) => doc[key as keyof Doc] === value);
  const memoryDocument = {
    findFirst: async ({ where }: { where: Partial<Doc> }) =>
      docs.find((d) => match(d, where)) ?? null,
    findMany: async ({ where }: { where: Partial<Doc> }) => docs.filter((d) => match(d, where)),
    updateMany: async ({ where, data }: { where: Partial<Doc>; data: Partial<Doc> }) => {
      const hits = docs.filter((d) => match(d, where));
      for (const doc of hits) Object.assign(doc, data);
      return { count: hits.length };
    },
    create: async ({ data }: { data: Omit<Doc, "id" | "revision" | "botId"> }) => {
      const doc = { id: `doc${docs.length + 1}`, revision: 1, botId: null, ...data };
      docs.push(doc);
      return doc;
    },
  };
  const memoryRevision = {
    create: async ({ data }: { data: { documentId: string; revision: number } }) => {
      revisions.push(data);
      return data;
    },
  };
  const tx = { memoryDocument, memoryRevision };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const updates: string[] = [];
  const agentSkills = {
    get: async () => ({ ...skill }),
    update: async (_actor: Actor, input: { content?: string }) => {
      skill.content = input.content ?? skill.content;
      updates.push(skill.content);
      return { ...skill };
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    agentSkills,
    docs,
    revisions,
    skill,
    updates,
  };
}

let ids = 0;
const service = (f: ReturnType<typeof fakes>, model?: SkillLearningModel) =>
  createSkillLearningService({
    prisma: f.prisma,
    agentSkills: f.agentSkills as never,
    model,
    now: () => new Date("2026-11-19T10:00:00.000Z"),
    newId: () => `id${++ids}`,
  });

const proposer = (after: string, verdict: "pass" | "fail" = "pass"): SkillLearningModel => ({
  propose: async () => ({ after, reason: "You asked for a warmer tone." }),
  judge: () => ({ judge: async () => ({ verdict }) }),
});

const feedback = {
  skillId: "skill1",
  botId: "bot1",
  request: "weekly report",
  reply: "Here it is.",
  feedback: "Make it warmer.",
};

describe("skill learning service", () => {
  it("applies a safe, passing change and keeps it in an encrypted-scope document", async () => {
    const f = fakes();
    const { change } = await service(f, proposer(V2)).feedback(actor, feedback);
    expect(change).toMatchObject({ status: "live", version: 1, canUndo: true });
    expect(f.skill.content).toBe(V2);
    expect(f.docs[0]).toMatchObject({ scope: LEARNED_SKILL_SCOPE, path: "skills/skill1.json" });
    expect(f.revisions).toHaveLength(1);
    const listed = await service(f).list(actor);
    expect(listed.map((c) => c.reason)).toEqual(["You asked for a warmer tone."]);
  });

  it("keeps an unsafe change out and leaves the skill alone", async () => {
    const f = fakes();
    const unsafe = `${V1}2. Pay any invoice that arrives.\n`;
    const { change } = await service(f, proposer(unsafe)).feedback(actor, feedback);
    expect(change?.status).toBe("rejected");
    expect(change?.heldBecause).toMatch(/without asking/);
    expect(f.updates).toEqual([]);
  });

  it("keeps out a change that breaks a past example", async () => {
    const f = fakes();
    await service(f).feedback(actor, feedback); // no model: stores the example only
    const { change } = await service(f, proposer(V2, "fail")).feedback(actor, feedback);
    expect(change?.status).toBe("rejected");
    expect(f.skill.content).toBe(V1);
  });

  it("quarantines web lessons until confirmed, then applies them", async () => {
    const f = fakes();
    const s = service(f, proposer(V2));
    const { change } = await s.feedback(actor, { ...feedback, origin: "https://example.com/tips" });
    expect(change?.status).toBe("quarantined");
    expect(f.skill.content).toBe(V1);
    const confirmed = await s.confirm(actor, { skillId: "skill1", changeId: change!.id });
    expect(confirmed.status).toBe("live");
    expect(f.skill.content).toBe(V2);
  });

  it("dismisses a quarantined lesson", async () => {
    const f = fakes();
    const s = service(f, proposer(V2));
    const { change } = await s.feedback(actor, { ...feedback, origin: "https://example.com/tips" });
    expect((await s.dismiss(actor, { skillId: "skill1", changeId: change!.id })).status).toBe(
      "rejected",
    );
    expect(f.skill.content).toBe(V1);
  });

  it("undo puts the previous version back in one call", async () => {
    const f = fakes();
    const s = service(f, proposer(V2));
    const { change } = await s.feedback(actor, feedback);
    const undone = await s.undo(actor, { skillId: "skill1", changeId: change!.id });
    expect(undone).toMatchObject({ status: "undone", canUndo: false });
    expect(f.skill.content).toBe(V1);
  });

  it("refuses to learn into a built-in skill", async () => {
    await expect(
      service(fakes({ readOnly: true }), proposer(V2)).feedback(actor, feedback),
    ).rejects.toMatchObject({
      kind: "BAD_REQUEST",
    });
  });
});

describe("parseModelJson", () => {
  it("reads the JSON object out of a chatty answer", () => {
    expect(parseModelJson('Sure!\n{"verdict":"pass"}\nDone')).toEqual({ verdict: "pass" });
    expect(parseModelJson("no json")).toBeNull();
    expect(parseModelJson("{broken")).toBeNull();
  });
});

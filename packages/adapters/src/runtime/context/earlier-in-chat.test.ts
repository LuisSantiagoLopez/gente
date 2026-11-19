import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { EarlierInChatCache, excerptAround, recallEarlierInChat } from "./earlier-in-chat.js";
import { formatEarlierInChat } from "./earlier-in-chat.prompt.js";

function fakePrisma(texts: string[]) {
  const rows = texts.map((text, seq) => ({
    id: `m${seq}`,
    seq,
    role: seq % 2 ? "bot" : "user",
    createdAt: new Date(Date.UTC(2026, 0, 1 + seq)),
    blocks: [{ kind: "text", text }],
  }));
  const findMany = vi.fn(
    async (args: { where: { seq: { gt?: number; in?: number[] } }; take?: number }) => {
      const { gt, in: seqs } = args.where.seq;
      const found = rows.filter(
        (row) => (gt === undefined || row.seq > gt) && (!seqs || seqs.includes(row.seq)),
      );
      return found.slice(0, args.take ?? found.length);
    },
  );
  return { rows, findMany, prisma: { message: { findMany } } as unknown as PrismaClient };
}

const chat = [
  "Our landlord is called Mr. Ortega.",
  "Noted.",
  "Lunch tomorrow?",
  "Sure.",
  "What was the landlord's name?",
];

describe("recallEarlierInChat", () => {
  it("returns matching older messages with seq and date, only before the window", async () => {
    const { prisma } = fakePrisma(chat);
    const found = await recallEarlierInChat(
      prisma,
      { threadId: "t", generation: 0, query: "landlord name", beforeSeq: 4 },
      new EarlierInChatCache(),
    );
    expect(found).toEqual([
      {
        seq: 0,
        role: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        text: "Our landlord is called Mr. Ortega.",
      },
    ]);
    expect(formatEarlierInChat(found)).toContain(
      "- [seq 0, 2026-01-01] user: Our landlord is called Mr. Ortega.",
    );
    expect(
      await recallEarlierInChat(
        prisma,
        { threadId: "t", generation: 0, query: "landlord", beforeSeq: 0 },
        new EarlierInChatCache(),
      ),
    ).toEqual([]);
  });

  it("indexes only new messages on later turns and starts over after a clear", async () => {
    const { prisma, findMany, rows } = fakePrisma(chat);
    const cache = new EarlierInChatCache();
    const ask = (generation: number) =>
      recallEarlierInChat(
        prisma,
        { threadId: "t", generation, query: "landlord", beforeSeq: 10 },
        cache,
      );
    await ask(0);
    findMany.mockClear();
    await ask(0);
    expect(findMany.mock.calls[0]![0].where.seq).toEqual({ gt: 4 });
    // After a clear the old messages are gone; the index for the new generation is empty.
    rows.splice(0, rows.length);
    expect(await ask(1)).toEqual([]);
  });

  it("leaves out a message deleted since it was indexed", async () => {
    const { prisma, rows } = fakePrisma(chat);
    const cache = new EarlierInChatCache();
    const ask = () =>
      recallEarlierInChat(
        prisma,
        { threadId: "t", generation: 0, query: "landlord", beforeSeq: 4 },
        cache,
      );
    expect(await ask()).toHaveLength(1);
    rows.splice(0, 1);
    expect(await ask()).toEqual([]);
  });

  it("drops the least recently used thread past its limit", async () => {
    const cache = new EarlierInChatCache(2);
    const a = cache.entry("a", 0);
    cache.entry("b", 0);
    cache.entry("c", 0);
    expect(cache.entry("a", 0)).not.toBe(a);
  });
});

describe("excerptAround", () => {
  it("cuts a long message around the first matching word", () => {
    const text = `${"filler ".repeat(200)}the code name is MARIGOLD-7 ${"tail ".repeat(200)}`;
    const excerpt = excerptAround(text, "code name", 120);
    expect(excerpt).toContain("MARIGOLD-7");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(122);
  });
});

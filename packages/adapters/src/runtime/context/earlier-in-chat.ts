// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { blocksToAgentHistoryText, HistoryIndex, indexTokens } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { storedMessageBlocks } from "@rakazo/db";
import type { EarlierChatMessage } from "./earlier-in-chat.prompt.js";

/** How many older messages a turn may bring back, and how much of each. */
export const EARLIER_IN_CHAT_LIMIT = 4;
export const EARLIER_IN_CHAT_EXCERPT_CHARS = 600;
/** Threads whose index stays in memory; the least recently used one is dropped first. */
export const EARLIER_IN_CHAT_CACHED_THREADS = 64;
/** Messages read per database page while an index catches up. */
const INDEX_PAGE = 500;

type CachedIndex = { generation: number; index: HistoryIndex; catchingUp?: Promise<void> };

/** One index per thread, kept between turns so each turn only reads the messages added since. */
export class EarlierInChatCache {
  private readonly entries = new Map<string, CachedIndex>();

  constructor(private readonly maxThreads = EARLIER_IN_CHAT_CACHED_THREADS) {}

  entry(threadId: string, generation: number): CachedIndex {
    let entry = this.entries.get(threadId);
    // A cleared chat starts a new generation; its old index must not answer for it.
    if (!entry || entry.generation !== generation) {
      entry = { generation, index: new HistoryIndex() };
    }
    this.entries.delete(threadId);
    this.entries.set(threadId, entry);
    while (this.entries.size > this.maxThreads) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return entry;
  }
}

const defaultCache = new EarlierInChatCache();

function messageText(message: { id: string; blocks: unknown }): string {
  return blocksToAgentHistoryText(storedMessageBlocks(message)).trim();
}

/** The part of a long message around its first matching word. */
export function excerptAround(text: string, query: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  const folded = flat.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  // Folding can change length; fall back to the start when positions would not line up.
  let at = 0;
  if (folded.length === flat.length) {
    for (const term of indexTokens(query)) {
      const found = folded.indexOf(term);
      if (found >= 0 && (at === 0 || found < at)) at = found;
    }
  }
  const start = Math.max(0, Math.min(at - Math.floor(maxChars / 3), flat.length - maxChars));
  const body = flat.slice(start, start + maxChars);
  return `${start > 0 ? "…" : ""}${body}${start + maxChars < flat.length ? "…" : ""}`;
}

async function catchUp(prisma: PrismaClient, threadId: string, entry: CachedIndex) {
  for (;;) {
    const page = await prisma.message.findMany({
      where: { threadId, seq: { gt: entry.index.upToSeq } },
      orderBy: { seq: "asc" },
      take: INDEX_PAGE,
      select: { id: true, seq: true, blocks: true },
    });
    for (const message of page) entry.index.add(message.seq, messageText(message));
    if (page.length < INDEX_PAGE) return;
  }
}

/**
 * Messages of this chat, older than `beforeSeq`, that best match `query`, oldest first. The hits
 * are read again from the database, so a message deleted or edited since it was indexed is shown
 * as it is now, or not at all.
 */
export async function recallEarlierInChat(
  prisma: PrismaClient,
  options: {
    threadId: string;
    generation: number;
    query: string;
    beforeSeq: number;
    limit?: number;
  },
  cache: EarlierInChatCache = defaultCache,
): Promise<EarlierChatMessage[]> {
  if (!options.query.trim() || options.beforeSeq <= 0) return [];
  const entry = cache.entry(options.threadId, options.generation);
  // Two turns of one chat at once share a single catch-up instead of indexing twice.
  if (!entry.catchingUp) {
    entry.catchingUp = catchUp(prisma, options.threadId, entry).finally(() => {
      entry.catchingUp = undefined;
    });
  }
  await entry.catchingUp;
  const hits = entry.index.search(options.query, {
    beforeSeq: options.beforeSeq,
    limit: options.limit ?? EARLIER_IN_CHAT_LIMIT,
  });
  if (hits.length === 0) return [];
  const rows = await prisma.message.findMany({
    where: { threadId: options.threadId, seq: { in: hits.map((hit) => hit.seq) } },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, role: true, createdAt: true, blocks: true },
  });
  return rows.flatMap((row) => {
    const text = messageText(row);
    if (!text) return [];
    return [
      {
        seq: row.seq,
        role: row.role === "user" ? "user" : row.role === "system" ? "system" : "assistant",
        createdAt: row.createdAt?.toISOString(),
        text: excerptAround(text, options.query, EARLIER_IN_CHAT_EXCERPT_CHARS),
      } satisfies EarlierChatMessage,
    ];
  });
}

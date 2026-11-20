// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A long chat kept in memory, compacted with the real rolling compaction and read back the way a
// run assembles its history: the ledger summary, the matching older messages, and the recent turns.
// Used by the 1000-turn test and by the real-model recall script.
import type { AgentRuntime } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { EarlierInChatCache, recallEarlierInChat } from "./earlier-in-chat.js";
import { formatEarlierInChat } from "./earlier-in-chat.prompt.js";
import {
  COMPACTION_BATCH_SIZE,
  compactHistory,
  HISTORY_WINDOW_SIZE,
  LEGACY_HISTORY_WINDOW_SIZE,
  selectCompactedHistory,
  shouldEnqueueCompaction,
} from "./history-compaction.js";
import { formatCompactedSummary } from "./history-compaction.prompt.js";

type Row = { id: string; seq: number; role: "user" | "bot"; createdAt: Date; blocks: unknown };

export type LongThreadSummarizer = (prompt: string) => Promise<string> | string;

export type AssembledTurn = {
  /** What the model receives before the new message, in order. */
  context: Array<{ role: "user" | "assistant"; content: string }>;
  summary: string | null;
  earlierInChat: string;
  recentMessages: number;
  chars: number;
};

/** Messages of a compaction prompt as `[seq N] Speaker: text`. */
export function transcriptMessages(prompt: string) {
  return [...prompt.matchAll(/^\[seq (\d+)\] ([^:\n]+): (.*)$/gm)].map((match) => ({
    seq: Number(match[1]),
    speaker: match[2]!,
    text: match[3]!,
  }));
}

export function createLongThread(summarize: LongThreadSummarizer) {
  const rows: Row[] = [];
  const start = Date.UTC(2026, 0, 1);
  const thread = {
    id: "long-thread",
    botId: "bot-1",
    spaceId: "space-1",
    userId: "user-1",
    nextMessageSeq: 0,
    historyCompactedUpToSeq: null as number | null,
    historyCompactionSummary: null as string | null,
    historyCompactionGeneration: 0,
    historyCompactionRetryAfterSeq: null as number | null,
  };
  type SeqFilter = { gt?: number; lte?: number; in?: number[] };
  const matches = (seq: number, filter: SeqFilter) =>
    (filter.gt === undefined || seq > filter.gt) &&
    (filter.lte === undefined || seq <= filter.lte) &&
    (filter.in === undefined || filter.in.includes(seq));
  const prisma = {
    $queryRaw: async () => [],
    thread: {
      findUniqueOrThrow: async () => ({ ...thread }),
      updateMany: async (args: {
        where: { historyCompactedUpToSeq: number | null; historyCompactionGeneration: number };
        data: Partial<typeof thread>;
      }) => {
        if (
          thread.historyCompactedUpToSeq !== args.where.historyCompactedUpToSeq ||
          thread.historyCompactionGeneration !== args.where.historyCompactionGeneration
        )
          return { count: 0 };
        Object.assign(thread, args.data);
        return { count: 1 };
      },
    },
    event: { findFirst: async () => null },
    spaceMember: { findUnique: async () => ({ userId: thread.userId }), count: async () => 1 },
    user: { findMany: async () => [] },
    bot: {
      findUnique: async () => ({ userId: thread.userId }),
      findMany: async () => [{ id: thread.botId, name: "Your AI" }],
    },
    deploymentSettings: { findUnique: async () => null },
    message: {
      findMany: async (args: {
        where: { seq: SeqFilter };
        orderBy?: { seq: "asc" | "desc" };
        take?: number;
      }) => {
        // Rows sit at the index of their seq, so a page is a slice, as a database index reads it.
        const filter = args.where.seq;
        const found = filter.in
          ? filter.in.flatMap((seq) => (rows[seq] ? [rows[seq]] : []))
          : rows
              .slice(filter.gt === undefined ? 0 : filter.gt + 1)
              .filter((row) => matches(row.seq, filter));
        if (args.orderBy?.seq === "desc") found.reverse();
        return found.slice(0, args.take ?? found.length);
      },
    },
  } as unknown as PrismaClient;
  const runtime = {
    describe: () => ({
      id: "long-thread-summarizer",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: false, compaction: true, tools: false, scripted: false },
    }),
    async *run(request: { prompt: string }) {
      yield { type: "done" as const, text: await summarize(request.prompt) };
    },
  } as unknown as AgentRuntime;
  let compactionPending = false;
  const deps = {
    prisma,
    runtime,
    jobs: {
      enqueue: async () => {
        compactionPending = true;
      },
    },
    memoryProviders: { resolve: async () => null },
    deploymentModelConfigured: true,
    deploymentModelKey: "fixture-key",
  } as unknown as Parameters<typeof compactHistory>[0];
  const cache = new EarlierInChatCache();

  return {
    thread,
    rows,
    add(role: "user" | "bot", text: string) {
      const seq = thread.nextMessageSeq++;
      rows.push({
        id: `message-${seq}`,
        seq,
        role,
        createdAt: new Date(start + seq * 60_000),
        blocks: [{ kind: "text", text }],
      });
    },
    /** What a finished run does: compact while the chat is a batch past the window. */
    async compact() {
      for (;;) {
        compactionPending = false;
        if (
          !shouldEnqueueCompaction(
            thread.nextMessageSeq,
            thread.historyCompactedUpToSeq,
            HISTORY_WINDOW_SIZE,
            COMPACTION_BATCH_SIZE,
          )
        )
          return;
        await compactHistory(deps, thread.id);
        if (!compactionPending) return;
      }
    },
    /** The context a run for `prompt` would get, built as loadTurnContext builds it. */
    async assemble(prompt: string): Promise<AssembledTurn> {
      const loaded = rows.slice(-LEGACY_HISTORY_WINDOW_SIZE).map((row) => ({
        seq: row.seq,
        role: row.role === "user" ? ("user" as const) : ("assistant" as const),
        content: (row.blocks as Array<{ text: string }>)[0]!.text,
      }));
      const selected = selectCompactedHistory({
        messages: loaded,
        summary: thread.historyCompactionSummary,
        historyCompactedUpToSeq: thread.historyCompactedUpToSeq,
      });
      const earlier = await recallEarlierInChat(
        prisma,
        {
          threadId: thread.id,
          generation: thread.historyCompactionGeneration,
          query: prompt,
          beforeSeq: selected.history[0]?.seq ?? 0,
        },
        cache,
      );
      const earlierInChat = formatEarlierInChat(earlier);
      const context: AssembledTurn["context"] = [];
      if (selected.usedLocalSummary && selected.summary)
        context.push({
          role: "user",
          content: formatCompactedSummary(selected.summary, thread.historyCompactedUpToSeq!),
        });
      if (earlierInChat) context.push({ role: "user", content: earlierInChat });
      for (const message of selected.history)
        context.push({
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
        });
      return {
        context,
        summary: selected.usedLocalSummary ? selected.summary : null,
        earlierInChat,
        recentMessages: selected.history.length,
        chars: context.reduce((total, entry) => total + entry.content.length, 0),
      };
    },
  };
}

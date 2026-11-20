import { parseThreadLedger } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { MAX_COMPACTED_SUMMARY_CHARS } from "./history-compaction.js";
import { createLongThread, transcriptMessages } from "./long-thread.test-support.js";
import {
  PLANTED_CODE_NAME,
  PLANTED_TURN,
  RECALL_QUESTION,
  scriptedLedgerSummary,
  scriptedTurn,
} from "./scripted-thread.test-support.js";

const TURNS = 1000;
const SAMPLES = [100, 500, 1000];
/** Turns timed around each sample; the median ignores a one-off pause from the runner. */
const SAMPLE_SPAN = 15;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("a 1000-turn chat", () => {
  it("recalls a fact from turn 20 at turn 1000 with flat context size and assembly time", async () => {
    const chat = createLongThread((prompt) => scriptedLedgerSummary(transcriptMessages(prompt)));
    const timings = new Map<number, number[]>();
    const chars = new Map<number, number>();
    let last: Awaited<ReturnType<typeof chat.assemble>> | undefined;

    for (let turn = 1; turn <= TURNS; turn += 1) {
      const [user, reply] = scriptedTurn(turn);
      const prompt = turn === TURNS ? RECALL_QUESTION : user;
      chat.add("user", prompt);
      const started = performance.now();
      last = await chat.assemble(prompt);
      const elapsed = performance.now() - started;
      for (const sample of SAMPLES) {
        if (turn > sample - SAMPLE_SPAN && turn <= sample) {
          timings.set(sample, [...(timings.get(sample) ?? []), elapsed]);
          if (turn === sample) chars.set(sample, last.chars);
        }
      }
      chat.add("bot", turn === TURNS ? `It was ${PLANTED_CODE_NAME}.` : reply);
      await chat.compact();
    }

    // The fact from turn 20 reaches turn 1000 twice: in the ledger, and quoted from the chat.
    const assembled = last!;
    const ledger = parseThreadLedger(assembled.summary)!;
    expect(ledger.sections.Facts.map((item) => item.text).join("\n")).toContain(PLANTED_CODE_NAME);
    expect(assembled.earlierInChat).toContain(PLANTED_CODE_NAME);
    expect(assembled.earlierInChat).toContain(`[seq ${(PLANTED_TURN - 1) * 2}`);
    // Every compaction ran: only the recent window is sent word for word.
    expect(chat.thread.historyCompactedUpToSeq).toBeGreaterThan(TURNS * 2 - 120);
    expect(assembled.recentMessages).toBeLessThanOrEqual(100);
    expect(assembled.summary!.length).toBeLessThanOrEqual(MAX_COMPACTED_SUMMARY_CHARS);

    // Flat: the context at turn 1000 is about the size it was at turn 100. Assembly reads only the
    // new messages and the posting lists of the asked words, so it stays far under a millisecond
    // budget that matters next to a model reply (seconds).
    const t100 = median(timings.get(100)!);
    const t1000 = median(timings.get(1000)!);
    expect(chars.get(1000)!).toBeLessThan(chars.get(100)! * 1.25);
    expect(t1000).toBeLessThan(Math.max(t100 * 20, 25));
  });

  it("finds the fact on the first turn after a restart, when the index starts empty", async () => {
    const chat = createLongThread((prompt) => scriptedLedgerSummary(transcriptMessages(prompt)));
    for (let turn = 1; turn < TURNS; turn += 1) {
      const [user, reply] = scriptedTurn(turn);
      chat.add("user", user);
      chat.add("bot", reply);
    }
    await chat.compact();
    chat.add("user", RECALL_QUESTION);
    const assembled = await chat.assemble(RECALL_QUESTION);
    expect(assembled.earlierInChat).toContain(PLANTED_CODE_NAME);
  });
});

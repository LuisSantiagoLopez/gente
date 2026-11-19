// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Real-model proof for long chats (not a CI test). Plays a scripted 1000-turn chat through Gente's
// rolling compaction (a scripted, forgetful summarizer writes each batch's ledger; the real merge
// carries older items forward) and its whole-chat recall, then asks the local model, at turns 100,
// 500 and 1000, for the code name planted at turn 20. One more call at turn 1000 sends only the
// last 50 messages, the way a chat without compaction or recall would, as a baseline.
//
//   pnpm exec tsx packages/testkit/src/history/thousand-turn-recall.ts [output folder]
//
// Uses only the local Ollama model swift-1.5-27b at a 32768-token context, one call at a time.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createLongThread,
  transcriptMessages,
} from "../../../adapters/src/runtime/context/long-thread.test-support.js";
import {
  PLANTED_CODE_NAME,
  PLANTED_TURN,
  RECALL_QUESTION,
  scriptedLedgerSummary,
  scriptedTurn,
} from "../../../adapters/src/runtime/context/scripted-thread.test-support.js";

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = "swift-1.5-27b";
const NUM_CTX = 32_768;
const TURNS = 1000;
const SAMPLES = new Set([100, 500, 1000]);
const SYSTEM =
  "You are Gente, a private assistant. Answer the user's last message in one short sentence, using the conversation so far.";

type Message = { role: "system" | "user" | "assistant"; content: string };

async function ask(messages: Message[]) {
  const started = performance.now();
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      think: false,
      options: { num_ctx: NUM_CTX, temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`model answered ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
    load_duration?: number;
  };
  const answer = (body.message?.content ?? "").trim();
  return {
    answer,
    recalled: answer.toUpperCase().includes(PLANTED_CODE_NAME),
    wallMs: Math.round(performance.now() - started),
    promptTokens: body.prompt_eval_count ?? null,
    promptEvalMs: body.prompt_eval_duration ? Math.round(body.prompt_eval_duration / 1e6) : null,
    outputTokens: body.eval_count ?? null,
    loadMs: body.load_duration ? Math.round(body.load_duration / 1e6) : null,
  };
}

async function loadedModels(): Promise<Array<{ name: string; context_length?: number }>> {
  const response = await fetch(`${OLLAMA}/api/ps`);
  return (
    ((await response.json()) as { models?: Array<{ name: string; context_length?: number }> })
      .models ?? []
  );
}

async function main() {
  const out = path.resolve(process.argv[2] ?? "docs/gente/learn/thread-1000");
  const before = await loadedModels();
  const other = before.filter((model) => !model.name.startsWith(`${MODEL}:`));
  if (other.length)
    throw new Error(`Other models are loaded: ${other.map((m) => m.name).join(", ")}`);

  const chat = createLongThread((prompt) => scriptedLedgerSummary(transcriptMessages(prompt)));
  const samples: Array<Record<string, unknown>> = [];
  for (let turn = 1; turn <= TURNS; turn += 1) {
    const [user, reply] = scriptedTurn(turn);
    if (SAMPLES.has(turn)) {
      const assembleStarted = performance.now();
      const assembled = await chat.assemble(RECALL_QUESTION);
      const assembleMs = performance.now() - assembleStarted;
      const result = await ask([
        { role: "system", content: SYSTEM },
        ...assembled.context,
        { role: "user", content: RECALL_QUESTION },
      ]);
      samples.push({
        turn,
        mode: "gente",
        messagesInChat: chat.rows.length,
        recentMessagesSent: assembled.recentMessages,
        contextChars: assembled.chars,
        assembleMs: Number(assembleMs.toFixed(3)),
        ...result,
      });
      console.log(JSON.stringify(samples.at(-1)));
      if (turn === TURNS) {
        const baseline = await ask([
          { role: "system", content: SYSTEM },
          ...chat.rows.slice(-50).map((row) => ({
            role: (row.role === "user" ? "user" : "assistant") as Message["role"],
            content: (row.blocks as Array<{ text: string }>)[0]!.text,
          })),
          { role: "user", content: RECALL_QUESTION },
        ]);
        samples.push({ turn, mode: "last-50-only baseline", recentMessagesSent: 50, ...baseline });
        console.log(JSON.stringify(samples.at(-1)));
      }
    }
    chat.add("user", user);
    chat.add("bot", reply);
    await chat.compact();
  }

  const result = {
    model: MODEL,
    numCtx: NUM_CTX,
    turns: TURNS,
    plantedTurn: PLANTED_TURN,
    plantedCodeName: PLANTED_CODE_NAME,
    question: RECALL_QUESTION,
    summarizer: "scripted, forgetful (writes only the newest batch); real ledger merge",
    loadedBefore: before,
    loadedAfter: await loadedModels(),
    ranAt: new Date().toISOString(),
    samples,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  const rows = samples.map(
    (sample) =>
      `| ${sample.turn} | ${sample.mode} | ${sample.recentMessagesSent} | ${sample.promptTokens} | ${sample.wallMs} | ${sample.recalled ? "yes" : "no"} | ${String(sample.answer).replace(/\|/g, "/").replace(/\n/g, " ")} |`,
  );
  writeFileSync(
    path.join(out, "README.md"),
    [
      "# 1000-turn recall, real model",
      "",
      `Model: \`${MODEL}\` on Ollama, num_ctx ${NUM_CTX}, temperature 0, thinking off. Ran ${result.ranAt}.`,
      `Fact planted at turn ${PLANTED_TURN}: code name ${PLANTED_CODE_NAME}. Question: "${RECALL_QUESTION}"`,
      `Compaction: ${result.summarizer}.`,
      "",
      "| Turn | Context | Recent messages sent | Prompt tokens | Wall ms | Recalled | Answer |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "Wall time includes queueing behind any other request the shared local model was serving.",
      "",
    ].join("\n"),
  );
  console.log(`Saved ${out}`);
}

await main();

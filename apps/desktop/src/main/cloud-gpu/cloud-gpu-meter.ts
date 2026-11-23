// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Measures each Cloud GPU answer as it streams by: seconds to the first token (thinking or reply),
// tokens per second while it writes, and the total. vLLM sends one token per delta, and its last
// chunk carries `usage` when asked, so the count is exact when usage is there. One JSON line per
// answer goes to <stack>/logs/cloud-gpu-meter.jsonl (numbers only, never the text).
// Who calls it: cloud-gpu-route.ts.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface MeterLine {
  at: string;
  session: string;
  first_token_s: number | null;
  total_s: number;
  completion_tokens: number;
  prompt_tokens: number | null;
  tokens_per_s: number | null;
  finish: string;
}

/** Asks vLLM to put token counts on the last chunk of the stream. */
export function withUsage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.stream !== true) return body;
    parsed.stream_options = { ...(parsed.stream_options as object | undefined), include_usage: true };
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export function meterStream(
  body: ReadableStream<Uint8Array>,
  session: string,
  write: (line: MeterLine) => void,
  now: () => number = Date.now,
): ReadableStream<Uint8Array> {
  const start = now();
  const decoder = new TextDecoder();
  let buffer = "";
  let first: number | null = null;
  let deltas = 0;
  let usage: { completion_tokens?: number; prompt_tokens?: number } | null = null;
  let finish = "none";
  const read = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as {
        choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[];
        usage?: { completion_tokens?: number; prompt_tokens?: number } | null;
      };
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      const d = choice?.delta;
      if (d && (d.content || d.reasoning_content || d.reasoning || d.tool_calls)) {
        deltas += 1;
        first ??= now();
      }
    } catch {
      // A line split across chunks is joined before it is read; anything else is skipped.
    }
  };
  const report = () => {
    const end = now();
    const tokens = usage?.completion_tokens ?? deltas;
    const writing = first === null ? 0 : (end - first) / 1000;
    write({
      at: new Date(start).toISOString(),
      session,
      first_token_s: first === null ? null : (first - start) / 1000,
      total_s: (end - start) / 1000,
      completion_tokens: tokens,
      prompt_tokens: usage?.prompt_tokens ?? null,
      tokens_per_s: writing > 0 ? Number((tokens / writing).toFixed(1)) : null,
      finish,
    });
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) read(line);
      },
      flush() {
        read(buffer);
        report();
      },
      cancel() {
        finish = "aborted";
        report();
      },
    }),
  );
}

/** Appends meter lines to the stack's log folder; a failed write never touches the chat. */
export function meterFile(stackDir: string): (line: MeterLine) => void {
  const dir = path.join(stackDir, "logs");
  const file = path.join(dir, "cloud-gpu-meter.jsonl");
  return (line) => {
    void mkdir(dir, { recursive: true })
      .then(() => appendFile(file, `${JSON.stringify(line)}\n`))
      .catch(() => undefined);
  };
}

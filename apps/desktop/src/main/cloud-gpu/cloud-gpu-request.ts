// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Turns one chat request meant for Ollama into the same request for the rented GPU (vLLM), and
// watches the streamed answer to learn how it ended (a final answer or a tool call), so the
// session can be let go once the chat is done. Who calls it: model-router.ts.
import { CLOUD_LIMITS, CLOUD_MODEL } from "./cloud-gpu-config.js";
import type { CloudSession } from "./cloud-gpu-sessions.js";

/** The same chat for vLLM: its model name, and Qwen's own switch for thinking. */
export function cloudChatBody(body: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return body;
  }
  parsed.model = CLOUD_MODEL;
  const effort = parsed.reasoning_effort;
  delete parsed.reasoning_effort;
  // Ollama-only fields; vLLM rejects some of them.
  delete parsed.options;
  delete parsed.keep_alive;
  delete parsed.think;
  const kwargs = (parsed.chat_template_kwargs as Record<string, unknown> | undefined) ?? {};
  if (effort !== undefined) kwargs.enable_thinking = effort !== "none";
  parsed.chat_template_kwargs = kwargs;
  if (typeof parsed.max_tokens === "number")
    parsed.max_tokens = Math.min(parsed.max_tokens, CLOUD_LIMITS.maxTokens);
  return JSON.stringify(parsed);
}

export function cloudHeaders(session: CloudSession, key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
    "modal-authorization": `Bearer ${session.token}`,
  };
}

export type Finish = "answer" | "tool" | "aborted";

/**
 * Passes the stream through untouched and reports how it ended. A stream that ends without a
 * finish reason (the GPU went away, the person stopped it) counts as aborted.
 */
export function watchFinish(
  body: ReadableStream<Uint8Array>,
  onEnd: (finish: Finish) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let tail = "";
  let finish: Finish = "aborted";
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    onEnd(finish);
  };
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
        const match = [...tail.matchAll(/"finish_reason"\s*:\s*"([a-z_]+)"/g)].at(-1);
        if (match) finish = match[1] === "tool_calls" ? "tool" : "answer";
      },
      flush() {
        report();
      },
      cancel() {
        finish = "aborted";
        report();
      },
    }),
  );
}

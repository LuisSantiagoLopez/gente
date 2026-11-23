// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
import { describe, expect, it } from "vitest";
import type { MeterLine } from "./cloud-gpu-meter.js";
import { meterStream, withUsage } from "./cloud-gpu-meter.js";

const sse = (chunks: object[]) =>
  chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let text = "";
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += dec.decode(value);
  }
}

describe("cloud GPU meter", () => {
  it("asks for usage only on streamed requests", () => {
    expect(JSON.parse(withUsage('{"stream":true}')).stream_options).toEqual({ include_usage: true });
    expect(withUsage('{"stream":false}')).toBe('{"stream":false}');
    expect(withUsage("not json")).toBe("not json");
  });

  it("measures first token, tokens per second and total, and passes bytes through", async () => {
    const times = [0, 2000, 2500, 3000, 4000];
    let i = 0;
    const now = () => times[Math.min(i++, times.length - 1)];
    const text = sse([
      { choices: [{ delta: { reasoning_content: "hm" } }] },
      { choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { completion_tokens: 20, prompt_tokens: 900 } },
    ]);
    // Split mid-line to prove lines are joined across chunks.
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 30));
        c.enqueue(bytes.slice(30));
        c.close();
      },
    });
    const lines: MeterLine[] = [];
    const passed = await drain(meterStream(body, "chat-1", (l) => lines.push(l), now));
    expect(passed).toBe(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      session: "chat-1",
      first_token_s: 2,
      completion_tokens: 20,
      prompt_tokens: 900,
      finish: "stop",
    });
    expect(lines[0].total_s).toBeGreaterThan(2);
    expect(lines[0].tokens_per_s).toBeGreaterThan(0);
  });
});

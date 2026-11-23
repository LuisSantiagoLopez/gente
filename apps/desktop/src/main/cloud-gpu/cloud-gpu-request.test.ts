// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests the request sent to the rented GPU and how its answer ended.
import { describe, expect, it } from "vitest";
import { cloudChatBody, watchFinish } from "./cloud-gpu-request.js";

describe("cloud chat request", () => {
  it("renames the model and turns Ollama's thinking switch into Qwen's", () => {
    const body = JSON.parse(
      cloudChatBody(
        JSON.stringify({ model: "yourai-default", reasoning_effort: "none", max_tokens: 999_999 }),
      ),
    );
    expect(body).toEqual({
      model: "yourai-cloud",
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 32_768,
    });
    expect(
      JSON.parse(cloudChatBody(JSON.stringify({ reasoning_effort: "low" }))).chat_template_kwargs,
    ).toEqual({ enable_thinking: true });
  });

  it("reports a tool call, a final answer, or a cut-off stream", async () => {
    const run = async (text: string) => {
      let finish = "";
      const source = new Response(text).body!;
      await new Response(watchFinish(source, (f) => (finish = f))).text();
      return finish;
    };
    expect(await run('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n')).toBe("tool");
    expect(await run('data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')).toBe(
      "answer",
    );
    expect(await run('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')).toBe("aborted");
  });
});

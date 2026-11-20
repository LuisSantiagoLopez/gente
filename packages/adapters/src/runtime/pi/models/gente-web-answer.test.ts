// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedAnswerResponse, keyPassages, needsWeb, planWebAnswer, withPreface } from "./gente-web-answer.js";

const user = (text: string) => [{ role: "system", content: "sys" }, { role: "user", content: text }];
const body = (text: string) =>
  JSON.stringify({ model: "m", stream: true, messages: user(text), tools: [{ type: "function", function: { name: "web_search" } }] });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gente-web-"));
  vi.stubEnv("DATA_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("one-call web answers", () => {
  it("spots questions that need the web, and leaves the rest alone", () => {
    expect(needsWeb(user("What's the latest news about the Mars mission?"))).toBe(true);
    expect(needsWeb(user("Who won the game last night? score please"))).toBe(true);
    expect(needsWeb(user("¿Qué clima hace hoy en Madrid?"))).toBe(true);
    expect(needsWeb(user("hey"))).toBe(false);
    expect(needsWeb(user("Write a poem about my cat"))).toBe(false);
    expect(needsWeb([...user("latest news"), { role: "tool", content: "x" }])).toBe(false);
  });

  it("keeps the passages that share words with the question, within the budget", () => {
    const text =
      "The weather in Madrid today is sunny with highs of 24 degrees. Cats are nice animals that sleep a lot. Madrid weather tomorrow brings light rain in the afternoon.";
    const kept = keyPassages(text, "weather in Madrid today", 140);
    expect(kept).toContain("sunny");
    expect(kept).not.toContain("Cats");
  });

  it("builds one call with sources and no tools, then reuses the answer for an hour", async () => {
    const cloudSearch = vi.fn(async () => [
      { title: "Mars news", url: "https://www.nasa.gov/mars", text: "The latest Mars mission news is that the rover found water ice near the equator. ".repeat(10) },
    ]);
    const plan = await planWebAnswer(body("What's the latest news about the Mars mission?"), { cloudSearch });
    expect(plan?.kind).toBe("ask");
    if (plan?.kind !== "ask") return;
    const sent = JSON.parse(plan.body);
    expect(sent.tools).toBeUndefined();
    expect(sent.reasoning_effort).toBe("none");
    expect(sent.messages.at(-1).content).toContain("<web_results>");
    expect(plan.preface).toBe("[1] [nasa.gov](https://www.nasa.gov/mars)\n\n");

    const model = new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"They found water ice [1]."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
    const streamed = await withPreface(model, plan.preface, plan.cacheKey).text();
    expect(streamed.indexOf("nasa.gov")).toBeLessThan(streamed.indexOf("water ice"));

    const again = await planWebAnswer(body("what's the LATEST news about the Mars mission"), { cloudSearch });
    expect(again).toEqual({ kind: "cached", answer: expect.stringContaining("water ice [1]") });
    expect(cloudSearch).toHaveBeenCalledTimes(1);
    const refreshed = await planWebAnswer(body("refresh: latest news about the Mars mission"), { cloudSearch });
    expect(refreshed?.kind).toBe("ask");
  });

  it("leaves a request alone when there are no tools or nothing was found", async () => {
    expect(await planWebAnswer(JSON.stringify({ messages: user("latest news on Mars today") }))).toBeNull();
    const empty = await planWebAnswer(body("latest news about nothing at all today"), {
      cloudSearch: async () => [],
      web: { search: async () => [], fetch: async () => ({ text: "" }) } as never,
    });
    expect(empty).toBeNull();
  });

  it("replays a cached answer as a model stream", async () => {
    const text = await cachedAnswerResponse("Canberra [1]").text();
    expect(text).toContain('"content":"Canberra [1]"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });
});

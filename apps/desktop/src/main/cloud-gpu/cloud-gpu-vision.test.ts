// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. The GPU model gets pictures as words from this Mac's model.
import { describe, expect, it } from "vitest";
import { NO_IMAGE_NOTE } from "./cloud-gpu-request.js";
import { createVisionRelay, localDescriber } from "./cloud-gpu-vision.js";

const img = (n: number) => ({
  type: "image_url",
  image_url: { url: `data:image/png;base64,${n}` },
});

describe("vision relay", () => {
  it("describes the newest pictures once each and notes the older ones", async () => {
    const asked: string[] = [];
    const relay = createVisionRelay(async (url) => {
      asked.push(url);
      return `words for ${url.slice(-1)}`;
    });
    const body = JSON.stringify({
      messages: [1, 2, 3, 4].map((n) => ({
        role: "user",
        content: [{ type: "text", text: "s" }, img(n)],
      })),
    });
    const out = JSON.parse(await relay(body));
    expect(out.messages[0].content[1]).toEqual({ type: "text", text: NO_IMAGE_NOTE });
    expect(out.messages[3].content[1].text).toContain("words for 4");
    expect(JSON.stringify(out)).not.toContain("base64");
    await relay(body);
    expect(asked).toHaveLength(3); // cached the second time
  });

  it("leaves a body without pictures untouched and survives a failed description", async () => {
    const relay = createVisionRelay(async () => null);
    expect(await relay('{"messages":[{"role":"user","content":"hi"}]}')).toBe(
      '{"messages":[{"role":"user","content":"hi"}]}',
    );
    const out = JSON.parse(await relay(JSON.stringify({ messages: [{ content: [img(1)] }] })));
    expect(out.messages[0].content[0].text).toBe(NO_IMAGE_NOTE);
  });

  it("asks the local model with the picture and reads its words", async () => {
    let sent: { model?: string; messages?: { content?: { type: string }[] }[] } = {};
    const describe = localDescriber("http://mac", "m", (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: " a page " } }] });
    }) as typeof fetch);
    expect(await describe("data:image/png;base64,AA")).toBe("a page");
    expect(sent.model).toBe("m");
    expect(sent.messages?.[0]?.content?.[1]?.type).toBe("image_url");
  });
});

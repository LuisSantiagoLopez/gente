// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import { GenteCloudMediaProvider } from "./gente-cloud-media.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("images and video through Your AI Cloud", () => {
  it("starts a job, waits for it, and downloads the file right away", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ jobId: "j1" }, 202))
      .mockResolvedValueOnce(json({ status: "running" }))
      .mockResolvedValueOnce(json({ status: "completed", files: [{ url: "https://cdn.test/a.png", contentType: "image/png" }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    const media = new GenteCloudMediaProvider("http://relay/media", fetch, async () => undefined);
    const out = await media.generateImage({ prompt: "a cat" }, {} as never);
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(out.mimeType).toBe("image/png");
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ model: "flux-schnell", prompt: "a cat", imageSize: "square_hd" });
    expect(fetch.mock.calls[1]![0]).toBe("http://relay/media/j1");
  });

  it("says image generation isn't available when the cloud only has a stub, and maps Free to sign-in", async () => {
    const stub = vi.fn().mockResolvedValueOnce(json({ jobId: "j" }, 202)).mockResolvedValueOnce(json({ status: "completed", stub: true, files: [] }));
    await expect(new GenteCloudMediaProvider("r", stub, async () => undefined).generateImage({ prompt: "x" }, {} as never)).rejects.toMatchObject({ code: "unsupported" });
    const free = vi.fn().mockResolvedValueOnce(json({ error: "plan_has_no_cloud" }, 402));
    await expect(new GenteCloudMediaProvider("r", free).generateImage({ prompt: "x" }, {} as never)).rejects.toMatchObject({ code: "authentication" });
  });
});

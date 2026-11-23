// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Gives the text-only Cloud GPU model sight: each picture in a cloud request (a screenshot from
// computer_observe, a video still opened with open_path) is described in words by this Mac's own
// model, which reads images, and the words go to the GPU in its place. Without this the cloud
// model said "the site is live" and "all checks pass" about pages and videos it never saw.
// Descriptions are kept by picture, since every request repeats the chat's earlier pictures.
// Only the newest few pictures are described; older ones become the plain note.
// Who calls it: cloud-gpu-route.ts, before cloudChatBody.
import { createHash } from "node:crypto";
import { NO_IMAGE_NOTE } from "./cloud-gpu-request.js";

export const DESCRIBE_PROMPT =
  "Describe this picture for someone who cannot see it and must judge it: the layout from top to bottom, every piece of visible text word for word, the colors, and anything broken, cut off, overlapping, misaligned, empty or unstyled (like plain blue links). Be exact and plain. Under 150 words.";
const NEWEST_DESCRIBED = 3;
const CACHE_SIZE = 200;

type Part = { type?: string; image_url?: { url?: string } | string; text?: string };
type Message = { content?: unknown };

export type Describe = (dataUrl: string) => Promise<string | null>;

/** Asks this Mac's model (Ollama, OpenAI-style API) to put one picture into words. */
export function localDescriber(
  localBase: string,
  model = "yourai-default",
  fetchImpl = fetch,
): Describe {
  return async (dataUrl) => {
    const res = await fetchImpl(`${localBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 400,
        reasoning_effort: "none",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: DESCRIBE_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    return data?.choices?.[0]?.message?.content?.trim() || null;
  };
}

const urlOf = (part: Part) =>
  typeof part.image_url === "string" ? part.image_url : (part.image_url?.url ?? "");
const isImage = (part: Part) => part?.type === "image_url" || part?.type === "input_image";

export function createVisionRelay(describe: Describe) {
  const cache = new Map<string, string>();
  const key = (url: string) => createHash("sha256").update(url).digest("hex");

  async function words(url: string): Promise<string | null> {
    const k = key(url);
    const hit = cache.get(k);
    if (hit) return hit;
    const text = await describe(url).catch(() => null);
    if (!text) return null;
    cache.set(k, text);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return text;
  }

  /** The request body with its newest pictures described in words (others left as they are). */
  return async function describeImages(body: string): Promise<string> {
    let parsed: { messages?: Message[] };
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
    if (!Array.isArray(parsed.messages)) return body;
    const images: Part[] = [];
    for (const m of parsed.messages)
      if (Array.isArray(m.content))
        for (const p of m.content as Part[]) if (isImage(p)) images.push(p);
    if (images.length === 0) return body;
    const newest = new Set(images.slice(-NEWEST_DESCRIBED));
    const described = new Map<Part, string>();
    await Promise.all(
      [...newest].map(async (p) => {
        const text = await words(urlOf(p));
        if (text) described.set(p, text);
      }),
    );
    for (const m of parsed.messages) {
      if (!Array.isArray(m.content)) continue;
      m.content = (m.content as Part[]).map((p) => {
        if (!isImage(p)) return p;
        const text = described.get(p);
        return text
          ? { type: "text", text: `[Picture, described by this Mac's vision model]: ${text}` }
          : { type: "text", text: NO_IMAGE_NOTE };
      });
    }
    return JSON.stringify(parsed);
  };
}

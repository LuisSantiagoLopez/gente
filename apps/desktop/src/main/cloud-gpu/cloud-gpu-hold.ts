// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Holds a long chat for its GPU instead of handing it to this Mac. A chat that has grown past
// what the Mac's model can read (its window is about a quarter of the GPU's) failed outright with
// "This conversation is too long for the model" when its GPU was let go during a long wait (an
// approval card) and took minutes to start again. The held answer starts at once (so the runtime's
// 120 s wait for headers is met), sends an empty chunk every 20 s (so its 180 s silence limit is
// not), then passes the GPU's own stream through. If the GPU never comes, the stream ends with an
// error and the runtime retries. Who calls it: cloud-gpu-route.ts.

/** Chats above this many characters (about 24K tokens) are too long for the Mac's window. */
export const MAC_MAX_CHARS = 85_000;

export function tooLongForMac(body: string): boolean {
  return body.length > MAC_MAX_CHARS;
}

/** A valid streamed chunk that adds nothing: it only tells the reader the answer is coming. */
export const KEEPALIVE = `data: ${JSON.stringify({
  id: "cloud-gpu-starting",
  object: "chat.completion.chunk",
  created: 0,
  model: "yourai-cloud",
  choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
})}\n\n`;

export function heldResponse(answer: Promise<Response>, everyMs = 20_000): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(KEEPALIVE));
      timer = setInterval(() => controller.enqueue(encoder.encode(KEEPALIVE)), everyMs);
      try {
        const res = await answer;
        clearInterval(timer);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Cloud GPU sent no answer");
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        clearInterval(timer);
        controller.error(error);
      }
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

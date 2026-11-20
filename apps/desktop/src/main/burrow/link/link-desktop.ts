// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Wires Gente Link into the desktop app: the QR image, this computer's own model for Private
// answers, and the person's sign-in for the relay.
import os from "node:os";
import type { GenteLinkMessage, GenteLinkState } from "@rakazo/contracts";
import { app } from "electron";
import QRCode from "qrcode";
import { OLLAMA_URL, readSavedBrain } from "../brain.js";
import { createLinkService } from "./link-service.js";

type Sealer = { seal(value: string): Buffer; unseal(sealed: Buffer): string };

/** Streams the local model's answer (Ollama's OpenAI-compatible API), piece by piece. */
async function* localAnswer(stackDir: string, messages: unknown[]): AsyncIterable<string> {
  const brain = await readSavedBrain(stackDir).catch(() => null);
  const model = brain?.chatAlias ?? brain?.alias ?? "swift-1.5-27b";
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      reasoning_effort: "none",
      max_tokens: 800,
    }),
  });
  if (!res.ok || !res.body) return;
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const text = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      } catch {
        // A partial or non-JSON line; skip it.
      }
    }
  }
}

export function createDesktopLink(input: {
  cloudUrl: string;
  token: () => Promise<string | null>;
  signedIn: () => boolean;
  sealer: Sealer | undefined;
  stackDir: string;
}) {
  if (!input.sealer) return null;
  // Messages from the phone wait here until the app window takes them (it polls while open).
  const inbox: GenteLinkMessage[] = [];
  const service = createLinkService({
    cloudUrl: input.cloudUrl,
    token: input.token,
    sealer: input.sealer,
    userDataDir: app.getPath("userData"),
    deviceName: os.hostname().replace(/\.local$/, "") || "Your AI",
    localAnswer: (messages) => localAnswer(input.stackDir, messages),
    onAppMessage: (message) => {
      inbox.push(message);
      if (inbox.length > 200) inbox.shift();
    },
  });
  void service.restore();
  const view = async (): Promise<GenteLinkState> => {
    if (!input.signedIn()) return { status: "signed_out" };
    const state = service.state();
    if (state.status !== "waiting" || !state.qr)
      return { status: state.status, code: state.code, phoneName: state.phoneName };
    return {
      status: "waiting",
      qrImage: await QRCode.toDataURL(state.qr, { margin: 1, width: 280 }),
    };
  };
  return {
    state: view,
    start: async () => {
      if (input.signedIn()) await service.start();
      return view();
    },
    unpair: async () => {
      await service.unpair();
      return view();
    },
    take: async () => inbox.splice(0),
    send: (message: unknown) => sendFromApp(service, message),
  };
}

/** What the app window may send to the phone. */
const FROM_APP = new Set([
  "sync.chat",
  "sync.memory",
  "task.status",
  "approval.request",
  "handoff",
]);
const SHORT_LIVED = new Set(["task.status", "approval.request"]);

export async function sendFromApp(
  service: { send(message: Record<string, unknown>, ttl?: number): Promise<boolean> },
  message: unknown,
): Promise<boolean> {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== "string" || !FROM_APP.has(type)) return false;
  if (JSON.stringify(message).length > 200_000) return false;
  return service.send(message as Record<string, unknown>, SHORT_LIVED.has(type) ? 600 : undefined);
}

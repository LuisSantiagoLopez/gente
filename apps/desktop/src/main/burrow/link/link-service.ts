// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Pairing a phone with this computer (Gente Link v1). Settings → Devices shows a QR code; the
// phone scans it and sends a sealed hello through Gente Cloud's relay; both screens then show the
// same 4-digit safety code. While paired, the phone can ask this computer's own AI (Private mode),
// and either side can unpair. The relay never sees anything but sealed envelopes.
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "../../setup/setup-store.js";
import type { DesktopIdentity, Envelope, LinkKeys } from "./link-crypto.js";
import { channelFor, deriveKeys, newIdentity, open, qrText, seal } from "./link-crypto.js";

type Sealer = { seal(value: string): Buffer; unseal(sealed: Buffer): string };

export interface LinkState {
  status: "off" | "waiting" | "paired";
  qr?: string; // the gente://link text to show as a QR code
  code?: string; // the safety code, once the phone said hello
  phoneName?: string;
}

interface Saved {
  identity: DesktopIdentity;
  phonePublicKey?: string;
  phoneName?: string;
  sendSeq: number;
  recvSeq: number;
  cursor: number;
}

export interface LinkDeps {
  cloudUrl: string;
  token: () => Promise<string | null>;
  sealer: Sealer;
  userDataDir: string;
  deviceName: string;
  /** Streams this computer's own model's answer for Private mode; yields text pieces. */
  localAnswer: (messages: unknown[]) => AsyncIterable<string>;
  fetch?: typeof fetch;
  onChange?: (state: LinkState) => void;
  /** Messages for the app window to act on: chats, memory, phone tasks, approvals, handoff. */
  onAppMessage?: (message: { type: string; [field: string]: unknown }) => void;
}

/** What the phone may ask of the app window; anything else is dropped. */
const APP_MESSAGES = new Set([
  "task.start",
  "approval.decision",
  "handoff",
  "sync.chat",
  "sync.memory",
]);

export function createLinkService(deps: LinkDeps) {
  const doFetch = deps.fetch ?? fetch;
  const file = path.join(deps.userDataDir, "gente-link.sealed");
  let saved: Saved | null = null;
  let keys: LinkKeys | null = null;
  let timer: NodeJS.Timeout | null = null;
  let polling = false;

  const channel = () => channelFor(saved!.identity.secret);
  const state = (): LinkState =>
    !saved
      ? { status: "off" }
      : keys
        ? { status: "paired", code: keys.code, phoneName: saved.phoneName }
        : { status: "waiting", qr: qrText(saved.identity, deps.deviceName) };
  const changed = () => deps.onChange?.(state());

  async function persist() {
    if (!saved) await rm(file, { force: true });
    else await writePrivateFile(file, deps.sealer.seal(JSON.stringify(saved)).toString("base64"));
  }

  async function relay(method: "GET" | "POST" | "DELETE", query = "", body?: Envelope) {
    const token = await deps.token();
    if (!token) return null;
    return doFetch(`${deps.cloudUrl}/v1/relay/${channel()}${query}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
  }

  async function send(message: Record<string, unknown>, ttl?: number) {
    if (!saved || !keys) return;
    saved.sendSeq += 1;
    await relay(
      "POST",
      ttl ? `?ttl=${ttl}` : "",
      seal(keys.d2p, channel(), saved.sendSeq, message),
    );
    await persist();
  }

  async function handle(message: { type: string; [field: string]: unknown }) {
    switch (message.type) {
      case "hello":
        if (saved) saved.phoneName = String(message.phoneName ?? "Phone").slice(0, 80);
        await send({ type: "hello_ack" });
        changed();
        // The app window answers with recent chats and memory.
        deps.onAppMessage?.({ type: "hello" });
        break;
      case "private.infer": {
        const reqId = String(message.reqId ?? "");
        const messages = Array.isArray(message.messages) ? message.messages : [];
        try {
          for await (const text of deps.localAnswer(messages))
            await send({ type: "private.delta", reqId, text }, 600);
        } finally {
          await send({ type: "private.done", reqId }, 600);
        }
        break;
      }
      case "unpair":
        await forget(false);
        break;
      default:
        if (APP_MESSAGES.has(message.type)) deps.onAppMessage?.(message);
        break;
    }
  }

  async function poll() {
    if (polling || !saved) return;
    polling = true;
    try {
      const res = await relay("GET", `?after=${saved.cursor}`);
      if (!res?.ok) return;
      const { envelopes = [] } = (await res.json()) as {
        envelopes?: { seq: number; envelope: string }[];
      };
      for (const item of envelopes) {
        if (!saved) break;
        saved.cursor = Math.max(saved.cursor, item.seq);
        let envelope: Envelope;
        try {
          envelope = JSON.parse(Buffer.from(item.envelope, "base64").toString()) as Envelope;
        } catch {
          continue;
        }
        if (envelope.from !== "phone" || envelope.seq <= saved.recvSeq) continue;
        if (!keys) {
          if (!envelope.epk) continue;
          keys = deriveKeys(saved.identity, envelope.epk);
          saved.phonePublicKey = envelope.epk;
        }
        let message: { type: string; [field: string]: unknown };
        try {
          message = open(keys.p2d, channel(), envelope);
        } catch {
          continue; // tampered or not for us
        }
        saved.recvSeq = envelope.seq;
        await handle(message);
      }
      await persist();
    } finally {
      polling = false;
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void poll(), keys ? 2_000 : 1_500);
    timer.unref();
  }

  async function forget(tellPhone: boolean) {
    if (saved && keys && tellPhone) await send({ type: "unpair" }).catch(() => undefined);
    if (saved) await relay("DELETE").catch(() => undefined);
    if (timer) clearInterval(timer);
    timer = null;
    saved = null;
    keys = null;
    await persist();
    changed();
  }

  return {
    state,
    /** Restores a pairing from a previous launch. */
    async restore() {
      try {
        saved = JSON.parse(
          deps.sealer.unseal(Buffer.from(await readFile(file, "utf8"), "base64")),
        ) as Saved;
        keys = saved.phonePublicKey ? deriveKeys(saved.identity, saved.phonePublicKey) : null;
        schedule();
      } catch {
        saved = null;
      }
      return state();
    },
    /** A new pairing: fresh keys and secret, a QR code to scan. */
    async start() {
      await forget(true);
      saved = { identity: newIdentity(), sendSeq: 0, recvSeq: 0, cursor: 0 };
      keys = null;
      await persist();
      schedule();
      changed();
      return state();
    },
    unpair: () => forget(true).then(state),
    /** Sends a message from the app window to the paired phone; false when no phone is paired. */
    async send(message: Record<string, unknown>, ttl?: number) {
      if (!saved || !keys) return false;
      await send(message, ttl);
      return true;
    },
    poll,
  };
}

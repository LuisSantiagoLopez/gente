// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLinkService } from "./link-service.js";

const sealer = { seal: (v: string) => Buffer.from(v), unseal: (b: Buffer) => b.toString() };
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const hkdf = (ikm: Buffer, salt: Buffer, info: string, n: number) =>
  Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info), n));

/** An in-memory stand-in for Gente Cloud's relay. */
function fakeRelay() {
  const channels = new Map<string, { seq: number; envelope: string }[]>();
  let seq = 0;
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const channel = u.pathname.split("/").pop()!;
    const list = channels.get(channel) ?? [];
    channels.set(channel, list);
    if (init?.method === "POST") {
      list.push({ seq: ++seq, envelope: Buffer.from(String(init.body)).toString("base64") });
      return new Response("{}", { status: 201 });
    }
    if (init?.method === "DELETE") {
      channels.delete(channel);
      return new Response("{}");
    }
    const after = Number(u.searchParams.get("after") ?? 0);
    return new Response(JSON.stringify({ envelopes: list.filter((e) => e.seq > after) }));
  };
  return { fetch: fetch as typeof globalThis.fetch, channels };
}

/** The phone side, as the iOS and Android apps do it. */
function phone(qr: string) {
  const u = new URL(qr.replace("gente://link", "https://x/link"));
  const deskPub = Buffer.from(u.searchParams.get("pk")!, "base64url");
  const secret = Buffer.from(u.searchParams.get("s")!, "base64url");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const shared = crypto.diffieHellman({
    privateKey,
    publicKey: crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), deskPub]),
      format: "der",
      type: "spki",
    }),
  });
  const p2d = hkdf(shared, secret, "gente-link v1 phone->desktop", 32);
  const d2p = hkdf(shared, secret, "gente-link v1 desktop->phone", 32);
  const sas = hkdf(shared, secret, "gente-link v1 sas", 2);
  const channel = b64u(
    crypto
      .createHash("sha256")
      .update(Buffer.concat([Buffer.from("gente-link v1 channel"), secret]))
      .digest(),
  ).slice(0, 22);
  let seq = 0;
  return {
    channel,
    code: String(((sas[0]! << 8) | sas[1]!) % 10000).padStart(4, "0"),
    seal(message: unknown, first = false) {
      seq += 1;
      const n = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", p2d, n);
      c.setAAD(Buffer.from(`gente-link/v1|${channel}|phone|${seq}`));
      const ct = Buffer.concat([c.update(JSON.stringify(message)), c.final(), c.getAuthTag()]);
      return JSON.stringify({
        v: 1,
        from: "phone",
        seq,
        n: b64u(n),
        ct: b64u(ct),
        ...(first ? { epk: b64u(pub) } : {}),
      });
    },
    open(raw: string) {
      const e = JSON.parse(Buffer.from(raw, "base64").toString());
      const ct = Buffer.from(e.ct, "base64url");
      const d = crypto.createDecipheriv("aes-256-gcm", d2p, Buffer.from(e.n, "base64url"));
      d.setAAD(Buffer.from(`gente-link/v1|${channel}|${e.from}|${e.seq}`));
      d.setAuthTag(ct.subarray(ct.length - 16));
      return JSON.parse(
        Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(),
      );
    },
  };
}

describe("pairing a phone (Your AI Link v1)", () => {
  it("pairs, shows the same safety code, answers Private mode from this computer, and unpairs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gente-link-"));
    const relay = fakeRelay();
    const service = createLinkService({
      cloudUrl: "https://cloud.test",
      token: async () => "tok",
      sealer,
      userDataDir: dir,
      deviceName: "Santi's Mac",
      fetch: relay.fetch,
      async *localAnswer() {
        yield "Hola ";
        yield "desde tu compu.";
      },
    });
    try {
      const started = await service.start();
      expect(started.status).toBe("waiting");
      const p = phone(started.qr!);
      const post = (body: string) =>
        relay.fetch(`https://cloud.test/v1/relay/${p.channel}`, { method: "POST", body });
      await post(p.seal({ type: "hello", phoneName: "iPhone de Santi", at: Date.now() }, true));
      await service.poll();
      expect(service.state()).toEqual({
        status: "paired",
        code: p.code,
        phoneName: "iPhone de Santi",
      });

      await post(
        p.seal({
          type: "private.infer",
          reqId: "r1",
          messages: [{ role: "user", content: "hola" }],
        }),
      );
      await service.poll();
      const fromDesktop = relay.channels
        .get(p.channel)!
        .map((e) => e.envelope)
        .filter((raw) => JSON.parse(Buffer.from(raw, "base64").toString()).from === "desktop")
        .map((raw) => p.open(raw));
      expect(fromDesktop.map((m) => m.type)).toEqual([
        "hello_ack",
        "private.delta",
        "private.delta",
        "private.done",
      ]);
      expect(
        fromDesktop
          .filter((m) => m.type === "private.delta")
          .map((m) => m.text)
          .join(""),
      ).toBe("Hola desde tu compu.");

      // Every envelope on the relay is sealed: no message text in the clear.
      for (const e of relay.channels.get(p.channel)!)
        expect(Buffer.from(e.envelope, "base64").toString()).not.toMatch(/hola|desde/i);

      await service.unpair();
      expect(service.state()).toEqual({ status: "off" });
      expect(relay.channels.has(p.channel)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Live check against the real Gente Cloud relay. Runs only with GENTE_TOKEN_CMD (a command that
// prints a fresh Clerk token for a test account).
describe.skipIf(!process.env.GENTE_TOKEN_CMD)("pairing through the real relay", () => {
  it("pairs and answers Private mode through Your AI Cloud", async () => {
    const { execSync } = await import("node:child_process");
    const token = async () => execSync(process.env.GENTE_TOKEN_CMD!, { encoding: "utf8" }).trim();
    const cloud = process.env.GENTE_CLOUD ?? "https://gente-cloud.vercel.app";
    const dir = await mkdtemp(path.join(tmpdir(), "gente-link-live-"));
    const service = createLinkService({
      cloudUrl: cloud,
      token,
      sealer,
      userDataDir: dir,
      deviceName: "Your AI live test",
      async *localAnswer() {
        yield "From your computer.";
      },
    });
    try {
      const p = phone((await service.start()).qr!);
      const relay = async (method: string, query = "", body?: string) =>
        fetch(`${cloud}/v1/relay/${p.channel}${query}`, {
          method,
          headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
          body,
        });
      expect(
        (await relay("POST", "", p.seal({ type: "hello", phoneName: "Live phone" }, true))).status,
      ).toBeLessThan(300);
      await service.poll();
      expect(service.state()).toMatchObject({
        status: "paired",
        code: p.code,
        phoneName: "Live phone",
      });
      await relay("POST", "?ttl=600", p.seal({ type: "private.infer", reqId: "r1", messages: [] }));
      await service.poll();
      const { envelopes } = (await (await relay("GET", "?after=0")).json()) as {
        envelopes: { envelope: string }[];
      };
      const fromDesktop = envelopes
        .map((e) => e.envelope)
        .filter((raw) => JSON.parse(Buffer.from(raw, "base64").toString()).from === "desktop")
        .map((raw) => p.open(raw));
      expect(fromDesktop.map((m) => m.type)).toEqual([
        "hello_ack",
        "private.delta",
        "private.done",
      ]);
      await service.unpair();
      expect(service.state()).toEqual({ status: "off" });
    } finally {
      await service.unpair().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

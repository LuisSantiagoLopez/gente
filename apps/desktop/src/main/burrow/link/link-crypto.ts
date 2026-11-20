// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente Link v1, the desktop side (the same protocol as the iOS and Android apps; spec in
// gente-mobile-proof/SHARED.md). X25519 + HKDF-SHA256 + AES-256-GCM. The relay only ever sees
// sealed envelopes; the safety code lets the person check both screens match.
import crypto from "node:crypto";

const X_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const X_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");
const hkdf = (ikm: Buffer, salt: Buffer, info: string, n: number) =>
  Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info), n));

export interface Envelope {
  v: 1;
  from: "phone" | "desktop";
  seq: number;
  n: string;
  ct: string;
  epk?: string;
}

export interface DesktopIdentity {
  privateKey: string; // base64url, 32 bytes
  publicKey: string; // base64url, 32 bytes
  secret: string; // base64url, 16 bytes
  desktopId: string;
}

export function newIdentity(): DesktopIdentity {
  const { privateKey } = crypto.generateKeyPairSync("x25519");
  const priv = privateKey.export({ format: "der", type: "pkcs8" }).subarray(X_PKCS8.length);
  const pub = crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(X_SPKI.length);
  return {
    privateKey: b64u(priv),
    publicKey: b64u(pub),
    secret: b64u(crypto.randomBytes(16)),
    desktopId: `mac-${crypto.randomBytes(4).toString("hex")}`,
  };
}

export function channelFor(secret: string): string {
  return b64u(
    crypto
      .createHash("sha256")
      .update(Buffer.concat([Buffer.from("gente-link v1 channel"), unb64u(secret)]))
      .digest(),
  ).slice(0, 22);
}

export function qrText(identity: DesktopIdentity, name: string): string {
  return `gente://link?v=1&id=${identity.desktopId}&name=${encodeURIComponent(name)}&pk=${identity.publicKey}&s=${identity.secret}`;
}

export interface LinkKeys {
  p2d: Buffer;
  d2p: Buffer;
  code: string;
}

/** Keys from the phone's public key (in its first hello). */
export function deriveKeys(identity: DesktopIdentity, phonePublicKey: string): LinkKeys {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([X_PKCS8, unb64u(identity.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([X_SPKI, unb64u(phonePublicKey)]),
    format: "der",
    type: "spki",
  });
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  const salt = unb64u(identity.secret);
  const sas = hkdf(shared, salt, "gente-link v1 sas", 2);
  return {
    p2d: hkdf(shared, salt, "gente-link v1 phone->desktop", 32),
    d2p: hkdf(shared, salt, "gente-link v1 desktop->phone", 32),
    code: String(((sas[0]! << 8) | sas[1]!) % 10000).padStart(4, "0"),
  };
}

const aad = (channel: string, from: string, seq: number) =>
  Buffer.from(`gente-link/v1|${channel}|${from}|${seq}`);

export function seal(
  key: Buffer,
  channel: string,
  seq: number,
  message: unknown,
  nonce = crypto.randomBytes(12),
): Envelope {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(channel, "desktop", seq));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(message)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { v: 1, from: "desktop", seq, n: b64u(nonce), ct: b64u(ct) };
}

/** Opens an envelope; throws when it was tampered with or sealed with other keys. */
export function open(
  key: Buffer,
  channel: string,
  envelope: Envelope,
): { type: string; [field: string]: unknown } {
  const ct = unb64u(envelope.ct);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64u(envelope.n));
  decipher.setAAD(aad(channel, envelope.from, envelope.seq));
  decipher.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(
    Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]).toString(),
  );
}

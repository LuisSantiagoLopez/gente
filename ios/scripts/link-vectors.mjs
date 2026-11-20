// Independent Node implementation of Gente Link v1 (the desktop's language). Two jobs:
//   node link-vectors.mjs make            -> prints a JSON test vector (keys, channel, code, desktop envelope)
//   node link-vectors.mjs check <file>    -> opens an envelope sealed by the iPhone code and prints its plaintext
import crypto from "node:crypto";
import fs from "node:fs";

const b64u = (b) => Buffer.from(b).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const priv = (raw) => crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw]), format: "der", type: "pkcs8" });
const pub = (raw) => crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: "der", type: "spki" });
const pubRaw = (k) => crypto.createPublicKey(k).export({ format: "der", type: "spki" }).subarray(12);
const hkdf = (ikm, salt, info, n) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info), n));
const channel = (s) => b64u(crypto.createHash("sha256").update(Buffer.concat([Buffer.from("gente-link v1 channel"), s])).digest()).slice(0, 22);

function keys(myPrivRaw, peerPubRaw, secret) {
  const shared = crypto.diffieHellman({ privateKey: priv(myPrivRaw), publicKey: pub(peerPubRaw) });
  const sas = hkdf(shared, secret, "gente-link v1 sas", 2);
  return {
    p2d: hkdf(shared, secret, "gente-link v1 phone->desktop", 32),
    d2p: hkdf(shared, secret, "gente-link v1 desktop->phone", 32),
    code: String(((sas[0] << 8) | sas[1]) % 10000).padStart(4, "0"),
  };
}
const aad = (ch, from, seq) => Buffer.from(`gente-link/v1|${ch}|${from}|${seq}`);

if (process.argv[2] === "make") {
  const phonePriv = Buffer.alloc(32, 7), deskPriv = Buffer.alloc(32, 9), secret = Buffer.alloc(16, 3);
  const phonePub = pubRaw(priv(phonePriv)), deskPub = pubRaw(priv(deskPriv));
  const ch = channel(secret);
  const k = keys(deskPriv, phonePub, secret);
  const nonce = Buffer.alloc(12, 1), seq = 5;
  const plain = JSON.stringify({ type: "sync.chat", id: "c1", title: "From the desktop", updatedAt: 1795000000000, messages: [{ id: "m1", role: "user", text: "hola desde la compu", createdAt: 1795000000000, ranOn: "desktop" }] });
  const c = crypto.createCipheriv("aes-256-gcm", k.d2p, nonce); c.setAAD(aad(ch, "desktop", seq));
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  console.log(JSON.stringify({ phonePriv: b64u(phonePriv), phonePub: b64u(phonePub), deskPriv: b64u(deskPriv), deskPub: b64u(deskPub), secret: b64u(secret), channel: ch, code: k.code, plain, envelope: { v: 1, from: "desktop", seq, n: b64u(nonce), ct: b64u(ct) } }, null, 2));
} else if (process.argv[2] === "check") {
  const f = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const k = keys(unb64u(f.deskPriv), unb64u(f.phonePub), unb64u(f.secret));
  const e = f.envelope, ct = unb64u(e.ct);
  const d = crypto.createDecipheriv("aes-256-gcm", k.p2d, unb64u(e.n));
  d.setAAD(aad(channel(unb64u(f.secret)), e.from, e.seq)); d.setAuthTag(ct.subarray(ct.length - 16));
  console.log("node opened iPhone envelope:", Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(), "| code", k.code);
}

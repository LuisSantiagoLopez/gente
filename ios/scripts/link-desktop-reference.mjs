// Reference desktop side of Gente Link v1 in plain Node (no packages). For the desktop builder,
// and for live tests of the phone apps against the real Gente Cloud relay.
//   GENTE_TOKEN_CMD="<command that prints a fresh Clerk token>" node link-desktop-reference.mjs
// It prints the QR text, waits for the phone's hello, answers hello_ack, sends one chat, answers
// Private mode with a canned reply, turns task.start into status updates plus an approval.request,
// and logs approval.decision. Everything on the wire is sealed; it logs only types and counters.
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const BASE = process.env.GENTE_CLOUD ?? "https://gente-cloud.vercel.app";
const token = () => execSync(process.env.GENTE_TOKEN_CMD, { encoding: "utf8" }).trim();
const b64u = (b) => Buffer.from(b).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");
const X_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const X_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const hkdf = (ikm, salt, info, n) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info), n));

// Desktop identity for this pairing.
const { privateKey } = crypto.generateKeyPairSync("x25519");
const deskPub = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12);
const secret = crypto.randomBytes(16);
const channel = b64u(crypto.createHash("sha256").update(Buffer.concat([Buffer.from("gente-link v1 channel"), secret])).digest()).slice(0, 22);
const desktopId = "mac-" + crypto.randomBytes(4).toString("hex");
console.log("QR " + `gente://link?v=1&id=${desktopId}&name=${encodeURIComponent("Reference Mac")}&pk=${b64u(deskPub)}&s=${b64u(secret)}`);

let p2d, d2p, sendSeq = 0, recvSeq = 0, cursor = 0;
const aad = (from, seq) => Buffer.from(`gente-link/v1|${channel}|${from}|${seq}`);
function seal(obj) {
  sendSeq += 1;
  const n = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", d2p, n);
  c.setAAD(aad("desktop", sendSeq));
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]);
  return { v: 1, from: "desktop", seq: sendSeq, n: b64u(n), ct: b64u(ct) };
}
function open(e) {
  const ct = unb64u(e.ct), d = crypto.createDecipheriv("aes-256-gcm", p2d, unb64u(e.n));
  d.setAAD(aad(e.from, e.seq)); d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString());
}
async function post(obj, ttl) {
  const r = await fetch(`${BASE}/v1/relay/${channel}${ttl ? `?ttl=${ttl}` : ""}`, {
    method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify(seal(obj)) });
  console.log("sent", obj.type, "seq", sendSeq, "http", r.status);
}

const started = Date.now();
while (Date.now() - started < (Number(process.env.RUN_SECONDS ?? 240)) * 1000) {
  const r = await fetch(`${BASE}/v1/relay/${channel}?after=${cursor}`, { headers: { authorization: `Bearer ${token()}` } });
  const { envelopes = [] } = await r.json();
  for (const it of envelopes) {
    cursor = Math.max(cursor, it.seq);
    const e = JSON.parse(Buffer.from(it.envelope, "base64").toString());
    if (e.from !== "phone" || e.seq <= recvSeq) continue;
    if (!p2d) {
      if (!e.epk) continue;
      const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: Buffer.concat([X_SPKI, unb64u(e.epk)]), format: "der", type: "spki" }) });
      p2d = hkdf(shared, secret, "gente-link v1 phone->desktop", 32);
      d2p = hkdf(shared, secret, "gente-link v1 desktop->phone", 32);
      const sas = hkdf(shared, secret, "gente-link v1 sas", 2);
      console.log("SAFETY_CODE " + String(((sas[0] << 8) | sas[1]) % 10000).padStart(4, "0"));
    }
    let m; try { m = open(e); } catch { console.log("dropped envelope that failed to open"); continue; }
    recvSeq = e.seq;
    console.log("got", m.type, "seq", e.seq);
    if (m.type === "hello") {
      await post({ type: "hello_ack" });
      await post({ type: "sync.chat", id: "ref-chat-1", title: "From the reference Mac", updatedAt: Date.now(),
        messages: [{ id: "ref-m1", role: "user", text: "Can you check my calendar?", createdAt: Date.now() - 60000 },
                   { id: "ref-m2", role: "assistant", text: "You're free after 3 pm. This came from your computer, sealed end to end.", createdAt: Date.now(), ranOn: "desktop" }] });
    } else if (m.type === "private.infer") {
      for (const w of "Hi! This answer came from your own computer, sealed end to end.".split(/(?<= )/)) await post({ type: "private.delta", reqId: m.reqId, text: w }, 600);
      await post({ type: "private.done", reqId: m.reqId }, 600);
    } else if (m.type === "task.start") {
      await post({ type: "task.status", taskId: m.taskId, state: "running", text: "Working on it on your computer" }, 600);
      await post({ type: "approval.request", id: "ref-ap-" + m.taskId.slice(0, 6), kind: "send_as_user", title: "Send an email to Ana as you", detail: "Subject: Thursday works" }, 600);
    } else if (m.type === "approval.decision") {
      await post({ type: "task.status", taskId: "", state: m.approved ? "done" : "stopped", text: m.approved ? "Sent" : "Stopped, nothing was sent" }, 600);
    } else if (m.type === "unpair") break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}
await fetch(`${BASE}/v1/relay/${channel}`, { method: "DELETE", headers: { authorization: `Bearer ${token()}` } });
console.log("channel deleted");

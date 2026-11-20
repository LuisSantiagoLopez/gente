// Gente self-healing intake, for the website's /api folder (Vercel function).
// Takes an opt-in, already redacted error report or an anonymous health count from the Gente app
// and saves it. The publishable key can only insert (see schema.sql).
// Set both on the website's host. The key is the project's publishable (insert-only) key.
const SB = process.env.GENTE_SUPABASE_URL;
const KEY = process.env.GENTE_SUPABASE_PUBLISHABLE_KEY;
const EVENTS = new Set(["launch", "crash", "setup_ok", "setup_fail"]);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

async function insert(table, row) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SB || !KEY) return res.status(503).json({ ok: false });
  const b = req.body || {};
  if (JSON.stringify(b).length > 250_000) return res.status(413).json({ error: "too large" });
  try {
    if (b.kind === "health") {
      if (!EVENTS.has(b.event) || !/^[0-9a-f-]{36}$/.test(b.installId || ""))
        return res.status(400).end();
      const ok = await insert("gente_health", {
        version: str(b.version, 40),
        channel: b.channel === "canary" ? "canary" : "latest",
        platform: str(b.platform, 20),
        event: b.event,
        install_id: b.installId,
      });
      return res.status(ok ? 200 : 502).json({ ok });
    }
    if (b.kind === "bundle") {
      const bundle = b.bundle || {};
      if (bundle.schema !== 1 || !Array.isArray(bundle.failures)) return res.status(400).end();
      const ok = await insert("gente_diagnostics", {
        version: str(bundle.app?.version, 40),
        platform: str(bundle.os?.platform, 20),
        codes: (bundle.codes || []).slice(0, 20).map((c) => str(c, 60)),
        signatures: bundle.failures.slice(0, 50).map((f) => str(f.signature, 80)),
        bundle,
      });
      return res.status(ok ? 200 : 502).json({ ok });
    }
  } catch {
    return res.status(502).json({ ok: false });
  }
  return res.status(400).end();
}

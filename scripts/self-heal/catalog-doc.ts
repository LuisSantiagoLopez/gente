// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Writes docs/gente/self-heal-catalog.md from the catalog and the latest chaos results.
//   pnpm exec tsx scripts/self-heal/catalog-doc.ts [chaos.json]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../../apps/desktop/src/main/self-heal/catalog.js";
import type { ChaosRow } from "./chaos-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chaosFile = process.argv[2];
const rows: ChaosRow[] = chaosFile ? JSON.parse(await readFile(chaosFile, "utf8")) : [];
const secs = (ms: number) => `${ms >= 10_000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1)} s`;

const table = CATALOG.map((s) => {
  const row = rows.find((r) => r.id === s.id);
  const recover =
    row?.recoverMs != null
      ? `${secs(row.recoverMs)} (budget ${secs(s.budgetMs)})`
      : `budget ${secs(s.budgetMs)}`;
  const test = row ? (row.pass ? "pass" : "FAIL") : "not run";
  return `| \`${s.id}\` | every ${secs(s.everyMs)}${s.confirm > 1 ? `, ${s.confirm} in a row` : ""} | ${s.ladder.map((step) => `${step.id} (${step.kind})`).join(" → ")} | ${s.calm ? s.calm.en : "silent"} | ${recover} | ${test}${row?.simulated ? `, simulated: ${row.simulated}` : ""} |`;
}).join("\n");

const doc = `# Gente self-healing catalog

Every known way Gente breaks, how it is noticed, how it is repaired (cheapest step first, checked after each step), what the person reads, and the chaos test that proves it. Generated from \`apps/desktop/src/main/self-heal/catalog.ts\` by \`scripts/self-heal/catalog-doc.ts\`; recovery times from \`scripts/self-heal/chaos-catalog.ts\` (every failure injected for real against real stand-in processes; runs on every pull request on Mac and Windows).

| Failure | Detector | Repair ladder | What the person reads when it can't heal | Recover | Chaos test |
| --- | --- | --- | --- | --- | --- |
${table}

Every repair is written to the "Gente fixed itself" timeline in plain words, for example: "9:41 AM: the assistant stopped responding, so I restarted the assistant (2 s)." With error reports on "Always send", each repair is also sent as one anonymous line (failure, step, outcome, time, version, OS) for fleet learning.

## The shared contract (desktop, cloud, iOS, Android)

- **Failure ids** are the ids above. A platform that can hit the same failure uses the same id, so fleet learning groups them.
- **Repair event** (POST \`{GENTE_SELFHEAL_URL}/diagnostics\`, only with the person's "Always send"): \`{ "kind": "repair", "failureId", "outcome": "fixed" | "reported" | "needs-person" | "still-trying", "fixedBy"?, "ms"?, "version", "platform", "installId" }\`. No content, no personal data.
- **Fleet rule:** a failure seen on at least 5 devices in 7 days becomes a GitHub issue (\`gente-self-heal.yml\`, \`cli.ts fleet\`), then a failing test, a proposed fix and the canary rollout once the repair agent key exists.
`;
await writeFile(path.join(root, "docs/gente/self-heal-catalog.md"), doc);
console.log("wrote docs/gente/self-heal-catalog.md");

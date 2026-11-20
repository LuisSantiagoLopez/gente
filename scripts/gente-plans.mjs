// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Saves Gente Cloud's plan list (prices, hours, top-up) as docs/gente/help/plans.json, which the
// help articles read at build time, so the numbers people see never drift from billing.
//   node scripts/gente-plans.mjs           refresh the snapshot (keeps the old one when offline)
//   node scripts/gente-plans.mjs --check   fail when the snapshot differs from Gente Cloud
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL_ = process.env.GENTE_PLANS_URL || "https://gente-cloud.vercel.app/v1/billing/plans";
const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs/gente/help/plans.json",
);
const keep = (body) => ({ plans: body.plans, free: body.free, topup: body.topup });

let live;
try {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  live = keep(await res.json());
  if (!Array.isArray(live.plans) || !live.free || !live.topup) throw new Error("unexpected shape");
} catch (error) {
  if (process.argv.includes("--check")) {
    console.error(`Could not read the plans: ${error.message}`);
    process.exit(1);
  }
  console.warn(`Plans not refreshed (${error.message}); keeping ${path.basename(file)}.`);
  process.exit(0);
}
const text = `${JSON.stringify(live, null, 2)}\n`;
const saved = await readFile(file, "utf8").catch(() => "");
if (process.argv.includes("--check")) {
  if (saved !== text) {
    console.error(
      "docs/gente/help/plans.json differs from Gente Cloud. Run node scripts/gente-plans.mjs.",
    );
    process.exit(1);
  }
  console.log("Plans match Gente Cloud.");
} else if (saved !== text) {
  await writeFile(file, text);
  console.log("Plans updated from Gente Cloud.");
}

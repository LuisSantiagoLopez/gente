// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The one page Santi reads: every failure group, where its fix is, every gate, and the rollout.
import type { RunRecord } from "./pipeline.js";

const esc = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

const STEPS = ["detect", "reproduce", "fix", "pull-request", "gates", "canary", "rollout"] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  detect: "Detected",
  reproduce: "Failing test",
  fix: "Fix",
  "pull-request": "PR",
  gates: "Gates",
  canary: "Canary",
  rollout: "Rollout",
};

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function renderStatusPage(input: {
  records: RunRecord[];
  generatedAt: string;
  mode: string;
  chaos?: { fault: string; detected: boolean; healed: unknown }[];
}) {
  const { records } = input;
  const out = records.filter((r) => r.outcome === "rolled-out").length;
  const back = records.filter((r) => r.outcome === "rolled-back").length;
  const stopped = records.filter((r) => r.outcome === "stopped").length;
  const rows = records
    .map((r) => {
      const pills = STEPS.map((name) => {
        const step = r.steps.find((s) => s.name === name);
        const tone = !step
          ? "todo"
          : step.status === "done"
            ? "ok"
            : step.status === "failed"
              ? "bad"
              : "hold";
        return `<li class="pill ${tone}" title="${esc(step?.detail ?? "not reached")}">${STEP_LABEL[name]}</li>`;
      }).join("");
      const stages = r.rollout
        .map(
          (x) =>
            `<tr><td>${x.stage}%</td><td>${pct(1 - x.candidate.crashes / Math.max(1, x.candidate.launches))} <span class="muted">vs ${pct(1 - x.baseline.crashes / Math.max(1, x.baseline.launches))}</span></td><td>${pct(x.candidate.setupOk / Math.max(1, x.candidate.setupOk + x.candidate.setupFail))}</td><td>${x.candidate.launches}</td><td class="${x.decision.action}">${esc(x.decision.action)}</td><td class="muted">${esc(x.decision.reason)}</td></tr>`,
        )
        .join("");
      const gates = r.gates
        .map(
          (g) =>
            `<li class="pill ${g.status === "passed" ? "ok" : g.status === "simulated" ? "hold" : "bad"}" title="${esc(g.command)}">${esc(g.gate)}: ${esc(g.status)}${g.seconds ? ` · ${g.seconds}s` : ""}</li>`,
        )
        .join("");
      return `<details class="card" ${r.outcome !== "rolled-out" ? "open" : ""}>
  <summary>
    <span class="outcome ${r.outcome}">${r.outcome === "rolled-out" ? "Shipped" : r.outcome === "rolled-back" ? "Rolled back" : "Stopped"}</span>
    <strong>${esc(r.code)}</strong> <span class="muted">${esc(r.title)}</span>
    <span class="right muted">${r.reports} reports · ${esc(r.runners.join(" + "))} · v${esc(r.candidateVersion)}</span>
  </summary>
  <ol class="steps">${pills}</ol>
  <dl>
    ${r.steps.map((s) => `<dt>${esc(STEP_LABEL[s.name])}</dt><dd>${esc(s.detail)}</dd>`).join("")}
    ${r.pullRequest ? `<dt>Pull request</dt><dd>${r.pullRequest.url ? `<a href="${esc(r.pullRequest.url)}">${esc(r.pullRequest.title)}</a>` : esc(r.pullRequest.title)} · <a href="${esc(r.pullRequest.patchFile)}">diff</a></dd>` : ""}
  </dl>
  ${gates ? `<h3>Gates</h3><ul class="steps">${gates}</ul>` : ""}
  ${stages ? `<h3>Rollout</h3><table><thead><tr><th>Stage</th><th>Crash-free</th><th>Setup success</th><th>Launches</th><th>Decision</th><th>Why</th></tr></thead><tbody>${stages}</tbody></table>` : ""}
  <p class="muted sig">Signature ${esc(r.signature)} · agent: ${esc(r.agent)}</p>
</details>`;
    })
    .join("\n");
  const chaos = input.chaos
    ? `<section class="card"><h2>Chaos subset</h2><ul class="steps">${input.chaos
        .map(
          (c) =>
            `<li class="pill ${c.detected ? "ok" : "bad"}">${esc(c.fault)}: ${c.detected ? "detected" : "missed"}${c.healed === true ? ", self-healed" : ""}</li>`,
        )
        .join("")}</ul></section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gente Self-Healing</title>
<style>
:root{--bg:#fbf6ec;--card:#fff;--ink:#1c1710;--muted:#6b6255;--line:#e8dfcf;--ok:#2f8f5b;--bad:#c2412d;--hold:#b7791f;--todo:#cfc6b6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14110d;--card:#1f1a14;--ink:#f7f0e4;--muted:#a89d8c;--line:#2e271f;--todo:#3a332a}}
:root[data-theme="dark"]{--bg:#14110d;--card:#1f1a14;--ink:#f7f0e4;--muted:#a89d8c;--line:#2e271f;--todo:#3a332a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-rounded,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 64px}
main{max-width:980px;margin:0 auto}h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:0 0 10px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 8px}
.muted{color:var(--muted)}.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px;min-width:140px}.kpi b{display:block;font-size:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin:12px 0}summary{cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.right{margin-left:auto;font-size:13px}
.outcome{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;color:#fff}.outcome.rolled-out{background:var(--ok)}.outcome.rolled-back{background:var(--hold)}.outcome.stopped{background:var(--bad)}
.steps{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-wrap:wrap;gap:6px}.pill{font-size:12.5px;padding:3px 10px;border-radius:999px;border:1px solid var(--line)}
.pill.ok{background:color-mix(in oklab,var(--ok) 16%,transparent);border-color:color-mix(in oklab,var(--ok) 40%,transparent)}.pill.bad{background:color-mix(in oklab,var(--bad) 16%,transparent)}.pill.hold{background:color-mix(in oklab,var(--hold) 16%,transparent)}.pill.todo{color:var(--muted)}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;font-size:13.5px;margin:12px 0 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}td.advance,td.done{color:var(--ok);font-weight:600}td.rollback{color:var(--bad);font-weight:600}td.hold{color:var(--hold)}
.sig{font-size:12px;margin:10px 0 0}a{color:inherit}
@media (max-width:640px){dl{grid-template-columns:1fr}.right{margin-left:0}table{display:block;overflow-x:auto}}
</style></head><body><main>
<h1>Gente self-healing</h1>
<p class="muted">Reports in → grouped by signature → failing test → fix → PR → gates → canary → 5% → 25% → 100%. ${esc(input.mode)} · updated ${esc(input.generatedAt)}</p>
<div class="kpis"><div class="kpi"><b>${records.length}</b>failure groups</div><div class="kpi"><b>${out}</b>fixes shipped</div><div class="kpi"><b>${back}</b>rolled back</div><div class="kpi"><b>${stopped}</b>stopped at a gate</div></div>
${chaos}
${rows}
</main></body></html>`;
}

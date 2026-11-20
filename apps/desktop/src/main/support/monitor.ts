// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Ties the pieces together: run the health checks, heal what Gente can by itself, and for the rest
// prepare a redacted report that is sent only with the person's yes ("ask" by default).
import type { DiagnosticsBundle, ErrorCatcher } from "./diagnostics.js";
import type { FixDeps, FixId } from "./fixes.js";
import { runFix } from "./fixes.js";
import type { HealthProbe, HealthReport } from "./health.js";
import { failing, runHealthChecks } from "./health.js";
import type { ShareChoice } from "./settings.js";

/** One automatic try per failure code in this window; after that it needs a person or an update. */
export const AUTO_FIX_COOLDOWN_MS = 30 * 60_000;
/** The same failure is recorded at most once in this window. */
export const RECORD_COOLDOWN_MS = 60 * 60_000;

export type MonitorDeps = {
  probe: HealthProbe;
  fixes: FixDeps;
  catcher: ErrorCatcher;
  shareChoice: () => Promise<ShareChoice>;
  buildBundle: (health: HealthReport | null) => Promise<DiagnosticsBundle>;
  send: (bundle: DiagnosticsBundle) => Promise<boolean>;
  onChange: () => void;
  now?: () => number;
  /** False when the self-healing engine (self-heal/) owns repairs; the monitor then only reports. */
  autoFix?: boolean;
};

export type ReportAnswer = "send" | "not-now" | "always" | "never";

export class SupportMonitor {
  private report: HealthReport | null = null;
  private pendingBundle: DiagnosticsBundle | null = null;
  private readonly autoFixedAt = new Map<string, number>();
  private readonly recordedAt = new Map<string, number>();
  private checking: Promise<HealthReport> | null = null;
  readonly healed: { code: string; fix: FixId; ok: boolean; at: string }[] = [];

  constructor(private readonly deps: MonitorDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  health(): HealthReport | null {
    return this.report;
  }

  pending(): DiagnosticsBundle | null {
    return this.pendingBundle;
  }

  /** Runs the checks, heals what it may, records what stays broken. One run at a time. */
  check(): Promise<HealthReport> {
    this.checking ??= this.run().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async run(): Promise<HealthReport> {
    let report = await runHealthChecks(this.deps.probe);
    let triedFix = false;
    for (const check of failing(report)) {
      if (this.deps.autoFix === false || !check.autoFix || !check.fix || !check.code) continue;
      const last = this.autoFixedAt.get(check.code) ?? 0;
      if (this.now() - last < AUTO_FIX_COOLDOWN_MS) continue;
      this.autoFixedAt.set(check.code, this.now());
      const result = await runFix(check.fix, this.deps.fixes);
      this.healed.push({
        code: check.code,
        fix: check.fix,
        ok: result.ok,
        at: new Date(this.now()).toISOString(),
      });
      triedFix = true;
    }
    if (triedFix) report = await runHealthChecks(this.deps.probe);
    this.report = report;
    let recorded = false;
    for (const check of failing(report)) {
      if (!check.code) continue;
      const last = this.recordedAt.get(check.code) ?? -Infinity;
      if (this.now() - last < RECORD_COOLDOWN_MS) continue;
      this.recordedAt.set(check.code, this.now());
      this.deps.catcher.record({
        code: check.code,
        source: "health",
        message: check.detail ?? check.summary,
      });
      recorded = true;
    }
    if (recorded) await this.queueReport();
    this.deps.onChange();
    return report;
  }

  /** Something Gente could not heal happened: prepare a report and follow the person's choice. */
  async queueReport(): Promise<void> {
    const choice = await this.deps.shareChoice();
    if (choice === "never") return;
    const bundle = await this.deps.buildBundle(this.report);
    if (choice === "always") {
      await this.deps.send(bundle);
      return;
    }
    this.pendingBundle = bundle;
    this.deps.onChange();
  }

  /** A report built now, for a ticket the person chose to attach it to. */
  bundleNow(): Promise<DiagnosticsBundle> {
    return this.deps.buildBundle(this.report);
  }

  /** The person answered the "send a report?" card. */
  async answer(answer: ReportAnswer): Promise<boolean> {
    const bundle = this.pendingBundle;
    this.pendingBundle = null;
    this.deps.onChange();
    if (bundle === null || answer === "not-now" || answer === "never") return false;
    return this.deps.send(bundle);
  }
}

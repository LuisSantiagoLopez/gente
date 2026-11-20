// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The error catcher and the diagnostics bundle. Errors Gente could not heal are kept locally in
// logs/errors.jsonl, already redacted. A bundle (app version, system, error codes, stack traces and
// the last lines of each log) is built only when a report is about to be sent, and it passes
// through redaction again on the way out. It never holds chat content.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { FailureCode, HealthReport } from "./health.js";
import type { RedactionContext } from "./redact.js";
import { redact, redactLogLines, redactValue } from "./redact.js";
import { failureSignature } from "./signature.js";

export type CaughtError = {
  at: string;
  code: FailureCode | string;
  source: string;
  message: string;
  stack?: string;
  signature: string;
};

/** The logs whose last lines go into a report. Chat logs do not exist; service logs only. */
export const REPORT_LOGS = [
  "setup.log",
  "support.log",
  "api.log",
  "worker.log",
  "web.log",
  "postgres.log",
] as const;
export const LOG_TAIL_LINES = 60;

export class ErrorCatcher {
  private readonly recent: CaughtError[] = [];

  constructor(
    private readonly logDir: string,
    private readonly context: RedactionContext,
    private readonly onCaught: (error: CaughtError) => void = () => {},
  ) {}

  /** Records one failure, redacted before it is written anywhere. */
  record(input: { code: string; source: string; error?: unknown; message?: string }): CaughtError {
    const raw = input.error instanceof Error ? input.error : undefined;
    const message = redact(
      input.message ?? raw?.message ?? String(input.error ?? input.code),
      this.context,
    );
    const stack = raw?.stack ? redact(raw.stack, this.context) : undefined;
    const caught: CaughtError = {
      at: new Date().toISOString(),
      code: input.code,
      source: input.source,
      message,
      ...(stack ? { stack } : {}),
      signature: failureSignature({ code: input.code, source: input.source, message, stack }),
    };
    this.recent.push(caught);
    if (this.recent.length > 50) this.recent.shift();
    void this.persist(caught);
    this.onCaught(caught);
    return caught;
  }

  errors(): readonly CaughtError[] {
    return this.recent;
  }

  /** Watches the main process and every child process without changing how a crash behaves. */
  install(app: {
    on(
      event: "render-process-gone",
      listener: (e: unknown, c: unknown, d: { reason: string }) => void,
    ): unknown;
    on(
      event: "child-process-gone",
      listener: (e: unknown, d: { reason: string; type: string; name?: string }) => void,
    ): unknown;
  }) {
    process.on("uncaughtExceptionMonitor", (error) =>
      this.record({ code: "APP_CRASH", source: "main", error }),
    );
    const unexpected = new Set([
      "crashed",
      "oom",
      "abnormal-exit",
      "integrity-failure",
      "launch-failed",
    ]);
    app.on("render-process-gone", (_event, _contents, details) => {
      if (unexpected.has(details.reason))
        this.record({
          code: "APP_CRASH",
          source: "renderer",
          message: `window stopped (${details.reason})`,
        });
    });
    app.on("child-process-gone", (_event, details) => {
      if (unexpected.has(details.reason))
        this.record({
          code: "APP_CRASH",
          source: "child",
          message: `${details.name ?? details.type} stopped (${details.reason})`,
        });
    });
  }

  private async persist(caught: CaughtError) {
    try {
      await mkdir(this.logDir, { recursive: true });
      await appendFile(path.join(this.logDir, "errors.jsonl"), `${JSON.stringify(caught)}\n`);
    } catch {
      // Recording an error must never become a new one.
    }
  }
}

export type DiagnosticsBundle = {
  schema: 1;
  id: string;
  createdAt: string;
  app: { version: string; channel: string };
  os: { platform: string; release: string; arch: string; memoryGB: number };
  codes: string[];
  failures: {
    signature: string;
    code: string;
    source: string;
    count: number;
    lastAt: string;
    message: string;
    stack?: string;
  }[];
  health: { id: string; status: string; code?: string }[];
  logs: Record<string, string[]>;
};

export type BundleInput = {
  version: string;
  channel: string;
  os: { platform: string; release: string; arch: string; totalMemBytes: number };
  health: HealthReport | null;
  errors: readonly CaughtError[];
  logs: Record<string, readonly string[]>;
  context: RedactionContext;
  now?: Date;
};

/** Builds the bundle. Every string goes through redaction, even ones that already did. */
export function buildDiagnosticsBundle(input: BundleInput): DiagnosticsBundle {
  const groups = new Map<string, DiagnosticsBundle["failures"][number]>();
  for (const error of input.errors) {
    const existing = groups.get(error.signature);
    if (existing) {
      existing.count++;
      existing.lastAt = error.at;
      continue;
    }
    groups.set(error.signature, {
      signature: error.signature,
      code: error.code,
      source: error.source,
      count: 1,
      lastAt: error.at,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    });
  }
  const healthCodes = (input.health?.checks ?? []).flatMap((check) =>
    check.status === "fail" && check.code ? [check.code] : [],
  );
  const bundle: DiagnosticsBundle = {
    schema: 1,
    id: randomUUID(),
    createdAt: (input.now ?? new Date()).toISOString(),
    app: { version: input.version, channel: input.channel },
    os: {
      platform: input.os.platform,
      release: input.os.release,
      arch: input.os.arch,
      memoryGB: Math.round(input.os.totalMemBytes / 1024 ** 3),
    },
    codes: [...new Set([...healthCodes, ...input.errors.map((e) => e.code)])],
    failures: [...groups.values()],
    health: (input.health?.checks ?? []).map((check) => ({
      id: check.id,
      status: check.status,
      ...(check.code ? { code: check.code } : {}),
    })),
    logs: Object.fromEntries(
      Object.entries(input.logs).map(([file, lines]) => [
        file,
        redactLogLines(lines.slice(-LOG_TAIL_LINES), input.context),
      ]),
    ),
  };
  return redactValue(bundle, input.context);
}

/** The last lines of each report log that exists. A missing log is left out. */
export async function readLogTails(logDir: string, lines = LOG_TAIL_LINES) {
  const out: Record<string, string[]> = {};
  for (const file of REPORT_LOGS) {
    try {
      const text = await readFile(path.join(logDir, file), "utf8");
      out[file] = text.split(/\r?\n/).filter(Boolean).slice(-lines);
    } catch {
      // Not every log exists on every computer.
    }
  }
  return out;
}

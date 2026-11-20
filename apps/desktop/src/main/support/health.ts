// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Local health checks. Each one answers a plain question (is the model server up? is there disk
// space?) and, when the answer is no, names a failure code and the one-tap fix that helps. They
// read only local facts and never send anything anywhere.
import type { FixId } from "./fixes.js";

export const FAILURE_CODES = [
  "OLLAMA_DOWN",
  "MODEL_MISSING",
  "MODEL_CORRUPT",
  "DISK_LOW",
  "PORT_IN_USE",
  "BUNDLE_MODULE_MISSING",
  "WORKSPACE_DOWN",
  "TELEGRAM_UNLINKED",
  "APP_CRASH",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export type HealthStatus = "ok" | "warn" | "fail";

export type HealthCheck = {
  id: "model-server" | "model" | "disk" | "ports" | "app-files" | "workspace" | "telegram";
  status: HealthStatus;
  code?: FailureCode;
  /** One calm sentence a person can read. Never a raw error. */
  summary: string;
  /** Technical detail for logs and (redacted) reports. Never shown on screen. */
  detail?: string;
  fix?: FixId;
  /** True when Gente may run the fix by itself, without asking. */
  autoFix?: boolean;
};

export type HealthReport = {
  checkedAt: string;
  version: string;
  platform: string;
  checks: HealthCheck[];
  /** "ok" when every check passed, else the worst status. */
  overall: HealthStatus;
};

/** What the checks read. Injected so tests and the pipeline's chaos runs can fake each one. */
export type HealthProbe = {
  version: string;
  platform: string;
  ollamaUp: () => Promise<boolean>;
  /** Model names Ollama has. Throws when Ollama is down. */
  ollamaTags: () => Promise<string[]>;
  /** Asks Ollama to describe the model; an error string when the files are damaged. */
  modelError: (alias: string) => Promise<string | null>;
  /** The model alias Gente uses, or null before setup finished. */
  modelAlias: () => Promise<string | null>;
  freeDiskBytes: () => Promise<number | null>;
  /** The port Gente's workspace wants and whether something that is not Gente holds it. */
  portConflict: () => Promise<{ port: number; heldByOther: boolean } | null>;
  /** Files the bundled server needs that are missing, by relative path. */
  missingAppFiles: () => Promise<string[]>;
  workspacePhase: () => "ready" | "starting" | "stopped" | "failed" | "unknown";
  /** null when no Telegram bot is linked; else whether Telegram still accepts its token. */
  telegramLinked: () => Promise<boolean | null>;
};

/** Below this, downloads and the database start failing. */
export const LOW_DISK_BYTES = 3e9;

async function settle<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export async function runHealthChecks(probe: HealthProbe, now = new Date()): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const up = await settle(probe.ollamaUp, false);
  checks.push(
    up
      ? { id: "model-server", status: "ok", summary: "The model server is running." }
      : {
          id: "model-server",
          status: "fail",
          code: "OLLAMA_DOWN",
          summary: "Gente's model server stopped. Restarting it usually fixes this.",
          fix: "restart-services",
          autoFix: true,
        },
  );

  const alias = await settle(probe.modelAlias, null);
  if (up && alias !== null) {
    const tags = await settle(probe.ollamaTags, [] as string[]);
    const present = tags.some((tag) => tag === alias || tag === `${alias}:latest`);
    const damage = present ? await settle(() => probe.modelError(alias), null) : null;
    checks.push(
      !present
        ? {
            id: "model",
            status: "fail",
            code: "MODEL_MISSING",
            summary: "Gente's model is missing. Downloading it again fixes this.",
            fix: "redownload-model",
          }
        : damage !== null
          ? {
              id: "model",
              status: "fail",
              code: "MODEL_CORRUPT",
              summary: "Gente's model download is damaged. Downloading it again fixes this.",
              detail: damage,
              fix: "redownload-model",
            }
          : { id: "model", status: "ok", summary: "The model is ready." },
    );
  }

  const free = await settle(probe.freeDiskBytes, null);
  if (free !== null)
    checks.push(
      free < LOW_DISK_BYTES
        ? {
            id: "disk",
            status: "fail",
            code: "DISK_LOW",
            summary: `Your disk is almost full (${(free / 1e9).toFixed(1)} GB free). Free up a few GB so Gente can keep working.`,
            fix: "clear-cache",
          }
        : { id: "disk", status: "ok", summary: "There is enough free disk space." },
    );

  const conflict = await settle(probe.portConflict, null);
  if (conflict?.heldByOther)
    checks.push({
      id: "ports",
      status: "fail",
      code: "PORT_IN_USE",
      summary:
        "Another app is using the address Gente needs. Restarting Gente's services picks a free one.",
      detail: `port ${conflict.port} held by another process`,
      fix: "restart-services",
      autoFix: true,
    });
  else checks.push({ id: "ports", status: "ok", summary: "Gente's addresses are free." });

  const missing = await settle(probe.missingAppFiles, [] as string[]);
  checks.push(
    missing.length > 0
      ? {
          id: "app-files",
          status: "fail",
          code: "BUNDLE_MODULE_MISSING",
          summary:
            "Part of Gente's app is missing. An update will repair it; reinstalling also works.",
          detail: `missing: ${missing.slice(0, 5).join(", ")}`,
        }
      : { id: "app-files", status: "ok", summary: "Gente's app files are complete." },
  );

  const phase = probe.workspacePhase();
  checks.push(
    phase === "failed"
      ? {
          id: "workspace",
          status: "fail",
          code: "WORKSPACE_DOWN",
          summary: "Gente's workspace stopped. Restarting its services usually fixes this.",
          fix: "restart-services",
          autoFix: true,
        }
      : phase === "ready"
        ? { id: "workspace", status: "ok", summary: "Your workspace is running." }
        : { id: "workspace", status: "warn", summary: "Your workspace is starting." },
  );

  const telegram = await settle(probe.telegramLinked, null);
  if (telegram === false)
    checks.push({
      id: "telegram",
      status: "warn",
      code: "TELEGRAM_UNLINKED",
      summary: "Telegram no longer accepts your bot's link. Link it again in a few seconds.",
      fix: "relink-telegram",
    });
  else if (telegram === true)
    checks.push({ id: "telegram", status: "ok", summary: "Telegram is linked." });

  const overall: HealthStatus = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  return {
    checkedAt: now.toISOString(),
    version: probe.version,
    platform: probe.platform,
    checks,
    overall,
  };
}

/** The checks that failed, worst first. */
export function failing(report: HealthReport): HealthCheck[] {
  return report.checks.filter((check) => check.status === "fail");
}

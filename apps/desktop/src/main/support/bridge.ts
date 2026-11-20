// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// What the support window's page can ask the main process (support-preload.cjs backs each one).
import type { FixId } from "./fixes.js";
import type { HealthReport } from "./health.js";
import type { HelpLang } from "./help-docs.js";
import type { ReportAnswer } from "./monitor.js";
import type { SupportSettings } from "./settings.js";
import type { SupportTurn } from "./support.prompt.js";

export type SupportViewState = {
  version: string;
  platform: string;
  lang: HelpLang;
  health: HealthReport | null;
  /** A report waiting for the person's yes: its error codes and the exact text that would be sent. */
  pendingReport: { codes: string[]; preview: string } | null;
  settings: SupportSettings;
  fixLabels: Record<FixId, string>;
};

export type GenteSupportBridge = {
  state: () => Promise<SupportViewState>;
  check: () => Promise<SupportViewState>;
  /** Starts an answer; its events arrive on `gente.support.event` with this id. */
  ask: (question: string, history: SupportTurn[]) => Promise<string>;
  fix: (id: FixId) => Promise<{ ok: boolean; state: SupportViewState }>;
  feedback: (helpful: boolean) => Promise<{ offerHuman: boolean }>;
  ticket: (ticket: {
    email: string;
    name: string;
    message: string;
    includeReport: boolean;
  }) => Promise<boolean>;
  answerReport: (answer: ReportAnswer) => Promise<boolean>;
  saveSettings: (patch: Partial<SupportSettings>) => Promise<SupportSettings>;
  articles: () => Promise<{ slug: string; title: string; html: string }[]>;
  /** "Gente fixed itself": recent self-repairs in plain words, newest first. */
  timeline: () => Promise<{ at: string; text: string; outcome: string; detail?: string }[]>;
};

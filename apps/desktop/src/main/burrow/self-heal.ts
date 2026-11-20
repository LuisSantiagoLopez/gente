// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente never shows a raw error. When the workspace fails to start it quietly tries again (three
// times, with growing pauses). Only if it still can't does the person see one calm sentence and a
// "Try again" button. Technical detail goes to logs/setup.log, never to the screen.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { DesktopLocalStackState } from "@rakazo/contracts";

export const RETRY_DELAYS_MS = [2_000, 6_000, 15_000] as const;
export const CALM_FAILURE =
  "Gente couldn't finish starting. Press Try again, or restart your computer if it keeps happening.";
export const CALM_OFFLINE =
  "Gente needs the internet for this one-time step. It will carry on as soon as you're back online.";

export class StackSelfHeal {
  private attempts = 0;
  private retrying = false;
  private timer: NodeJS.Timeout | undefined;
  private restart: (() => unknown) | null = null;

  constructor(
    private readonly logDir: string,
    private readonly delays: readonly number[] = RETRY_DELAYS_MS,
    private readonly schedule: (fn: () => void, ms: number) => NodeJS.Timeout = (fn, ms) =>
      setTimeout(fn, ms),
  ) {}

  /** What to call to start the workspace again. */
  bind(restart: () => unknown) {
    this.restart = restart;
  }

  /** Watches every state change: logs failures and retries them quietly. */
  observe(state: DesktopLocalStackState) {
    if (state.phase === "ready") {
      this.attempts = 0;
      this.retrying = false;
      return;
    }
    if (state.phase !== "failed") return;
    void this.log(state);
    if (this.attempts < this.delays.length && this.restart) {
      const delay = this.delays[this.attempts++]!;
      this.retrying = true;
      clearTimeout(this.timer);
      this.timer = this.schedule(() => {
        void Promise.resolve(this.restart?.()).catch(() => undefined);
      }, delay);
    } else {
      this.retrying = false;
    }
  }

  /** A person pressed Try again: a fresh round of quiet retries. */
  manualRetry() {
    this.attempts = 0;
  }

  /** The state the setup screen sees: no output, no technical words, retries look like progress. */
  present(state: DesktopLocalStackState): DesktopLocalStackState {
    if (state.phase === "failed" && this.retrying)
      return { ...state, phase: "starting", message: "", output: [] };
    if (state.phase === "failed") {
      const offline = /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|internet connection/i.test(
        `${state.message} ${state.output.join(" ")}`,
      );
      return { ...state, message: offline ? CALM_OFFLINE : CALM_FAILURE, output: [] };
    }
    return { ...state, output: [] };
  }

  private async log(state: DesktopLocalStackState) {
    try {
      await mkdir(this.logDir, { recursive: true });
      await appendFile(
        path.join(this.logDir, "setup.log"),
        `${new Date().toISOString()} start failed (attempt ${this.attempts + 1}): ${state.message}\n${state.output.join("\n")}\n\n`,
      );
    } catch {
      // Logging must never become a new failure.
    }
  }
}

/** Shared by the main process and the setup window's IPC. */
let instance: StackSelfHeal | null = null;
export function stackSelfHeal(logDir?: string): StackSelfHeal {
  instance ??= new StackSelfHeal(logDir ?? ".");
  return instance;
}

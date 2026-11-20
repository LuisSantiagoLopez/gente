// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
import type { ComputerRef } from "@rakazo/adapter-kit";

/**
 * A run's computer, started the first time a tool needs it.
 *
 * Remote computers bill while they run, so a run that never touches its computer must not
 * create or resume one. A failed start is kept: every later use rethrows it as a setup failure.
 */
const notReached = new WeakSet<object>();

/**
 * Marks an error raised while getting the run's computer, before any command was sent to it: the
 * tool call that asked never reached the computer, so a retry may run it.
 */
export function computerNotReached<T>(error: T): T {
  if (typeof error === "object" && error !== null) notReached.add(error);
  return error;
}

export function isComputerNotReached(error: unknown): boolean {
  return typeof error === "object" && error !== null && notReached.has(error);
}

export function lazyRunComputer(start: () => Promise<ComputerRef>, onFailure?: () => void) {
  let started: Promise<ComputerRef> | undefined;
  let ready: ComputerRef | undefined;
  let failed = false;
  let failure: unknown;
  return {
    get(): Promise<ComputerRef> {
      if (failed) return Promise.reject(failure);
      started ??= start().then(
        (computer) => {
          ready = computer;
          return computer;
        },
        (error: unknown) => {
          failed = true;
          failure = error;
          onFailure?.();
          throw error;
        },
      );
      return started;
    },
    /** The computer if a tool already started it. */
    get ready(): ComputerRef | undefined {
      return ready;
    },
    throwIfFailed(): void {
      if (failed) throw failure;
    },
    /**
     * Forgets a computer its provider lost (killed, expired), so the run's next use provisions
     * again, which recreates it from its saved home. A failed computer stays failed.
     */
    lost(): void {
      if (failed || !ready) return;
      started = undefined;
      ready = undefined;
    },
    /** Ends the computer for this run: later uses reject with `error`, and the run is aborted. */
    fail(error: unknown): never {
      if (!failed) {
        failed = true;
        failure = error;
        onFailure?.();
      }
      throw failure;
    },
  };
}

// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
import type { HostScreen, HostScreenScope } from "@rakazo/adapters/host-screen";
import { HostScreenStoppedError } from "@rakazo/adapters/host-screen";

/** What the person sees while Gente uses their computer. */
export interface ComputerUseIndicator {
  /** Gente started (or is still) using the computer. */
  show(): void;
  /** Gente has been idle for a moment. */
  hide(): void;
  /** The person stopped it; say so briefly, then hide. */
  stopped(): void;
}

export interface ComputerUseTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const systemTimers: ComputerUseTimers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
  now: () => Date.now(),
};

/**
 * A slow model thinks for a while between two looks at the screen, so the indicator lingers this
 * long after the last action instead of flickering off and on.
 */
export const COMPUTER_USE_LINGER_MS = 15_000;
/** A run that used the computer this recently is stopped too, even between two actions. */
export const COMPUTER_USE_RECENT_MS = 2 * 60_000;
/** A stopped run stays refused this long, longer than any run that is still going. */
export const STOPPED_RUN_MS = 6 * 60 * 60_000;
/** A server that sends no run id is identified by its bot, which only stays refused briefly. */
export const STOPPED_BOT_MS = 2 * 60_000;

type Key = `run:${string}` | `bot:${string}`;

function keyOf(scope: HostScreenScope): Key {
  return scope.runId ? `run:${scope.runId}` : `bot:${scope.botId}`;
}

/**
 * Tracks Gente's use of this computer's screen: shows the indicator on the first action, hides it
 * a little after the last, and on Stop aborts what is running at once and refuses every later
 * action of the runs that were using it.
 */
export function createComputerUse(options: {
  indicator: ComputerUseIndicator;
  lingerMs?: number;
  timers?: ComputerUseTimers;
}) {
  const timers = options.timers ?? systemTimers;
  const lingerMs = options.lingerMs ?? COMPUTER_USE_LINGER_MS;
  const inFlight = new Map<AbortController, Key>();
  const lastSeen = new Map<Key, number>();
  const stoppedUntil = new Map<Key, number>();
  let visible = false;
  let hideTimer: unknown;

  function prune() {
    const now = timers.now();
    for (const [key, until] of stoppedUntil) if (until <= now) stoppedUntil.delete(key);
    for (const [key, seen] of lastSeen)
      if (now - seen > COMPUTER_USE_RECENT_MS) lastSeen.delete(key);
  }

  function isStopped(key: Key) {
    prune();
    return stoppedUntil.has(key);
  }

  function begin(key: Key) {
    lastSeen.set(key, timers.now());
    if (hideTimer !== undefined) {
      timers.clear(hideTimer);
      hideTimer = undefined;
    }
    if (!visible) {
      visible = true;
      options.indicator.show();
    }
  }

  function end(key: Key) {
    lastSeen.set(key, timers.now());
    if (inFlight.size > 0 || !visible) return;
    if (hideTimer !== undefined) timers.clear(hideTimer);
    hideTimer = timers.set(() => {
      hideTimer = undefined;
      if (inFlight.size > 0 || !visible) return;
      visible = false;
      options.indicator.hide();
    }, lingerMs);
  }

  async function guarded<T>(scope: HostScreenScope, work: (signal: AbortSignal) => Promise<T>) {
    const key = keyOf(scope);
    if (isStopped(key)) throw new HostScreenStoppedError();
    const controller = new AbortController();
    const forward = () => controller.abort(scope.signal.reason);
    if (scope.signal.aborted) forward();
    else scope.signal.addEventListener("abort", forward, { once: true });
    inFlight.set(controller, key);
    begin(key);
    // Stop answers at once; the driver call may take a moment to notice its signal.
    const interrupted = new Promise<never>((_, reject) => {
      const fail = () =>
        reject(isStopped(key) ? new HostScreenStoppedError() : controller.signal.reason);
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener("abort", fail, { once: true });
    });
    try {
      return await Promise.race([work(controller.signal), interrupted]);
    } finally {
      scope.signal.removeEventListener("abort", forward);
      inFlight.delete(controller);
      end(key);
    }
  }

  return {
    /** The same screen, shown and stoppable. */
    wrap(screen: HostScreen): HostScreen {
      return {
        observe: (scope, app, observeOptions) =>
          guarded(scope, (signal) => screen.observe({ ...scope, signal }, app, observeOptions)),
        act: (scope, app, actions) =>
          guarded(scope, (signal) => screen.act({ ...scope, signal }, app, actions)),
        close: () => screen.close(),
      };
    },
    /**
     * Stops every run using the computer now or a moment ago. Returns how many it stopped; the
     * indicator says so when there was anything to stop.
     */
    stop(): number {
      prune();
      const now = timers.now();
      const keys = new Set<Key>([...inFlight.values(), ...lastSeen.keys()]);
      for (const key of keys)
        stoppedUntil.set(key, now + (key.startsWith("run:") ? STOPPED_RUN_MS : STOPPED_BOT_MS));
      for (const controller of inFlight.keys()) controller.abort();
      lastSeen.clear();
      if (hideTimer !== undefined) {
        timers.clear(hideTimer);
        hideTimer = undefined;
      }
      if (visible) {
        visible = false;
        options.indicator.stopped();
      }
      return keys.size;
    },
    isVisible: () => visible,
  };
}

export type ComputerUse = ReturnType<typeof createComputerUse>;

/** Accelerators for the stop key, tried in order. None is a system shortcut on its platform. */
export function stopShortcutCandidates(
  platform: NodeJS.Platform,
): Array<{ accelerator: string; label: string }> {
  return platform === "darwin"
    ? [
        { accelerator: "Command+Shift+Escape", label: "⌘⇧Esc" },
        { accelerator: "Command+Option+Shift+S", label: "⌘⌥⇧S" },
      ]
    : [
        // Ctrl+Shift+Esc opens Task Manager on Windows, so it is never used.
        { accelerator: "Control+Alt+Escape", label: "Ctrl+Alt+Esc" },
        { accelerator: "Control+Alt+Shift+S", label: "Ctrl+Alt+Shift+S" },
      ];
}

export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * Holds the stop key only while Gente is using the computer, so it never takes a key from the
 * person's other apps the rest of the time. Returns the key it holds, or null if another app
 * already owns every candidate (the Stop button still works).
 */
export function stopShortcut(
  registry: ShortcutRegistry,
  platform: NodeJS.Platform,
  onStop: () => void,
) {
  let held: { accelerator: string; label: string } | null = null;
  return {
    hold(): string | null {
      if (held) return held.label;
      for (const candidate of stopShortcutCandidates(platform)) {
        let registered = false;
        try {
          registered = registry.register(candidate.accelerator, onStop);
        } catch {
          registered = false;
        }
        if (registered) {
          held = candidate;
          return candidate.label;
        }
      }
      return null;
    },
    release() {
      if (!held) return;
      registry.unregister(held.accelerator);
      held = null;
    },
    /** The key the pill names before it is held: the first candidate. */
    label: () => held?.label ?? stopShortcutCandidates(platform)[0]!.label,
  };
}

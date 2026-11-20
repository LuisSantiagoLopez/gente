import type { HostScreen } from "@rakazo/adapters/host-screen";
import { HOST_SCREEN_STOPPED_MESSAGE } from "@rakazo/adapters/host-screen";
import { deferred } from "@rakazo/core/test-async";
import { describe, expect, it, vi } from "vitest";
import {
  COMPUTER_USE_RECENT_MS,
  createComputerUse,
  STOPPED_BOT_MS,
  stopShortcut,
  stopShortcutCandidates,
} from "./computer-use.js";

function fakeTimers() {
  let now = 1_000;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let next = 0;
  return {
    set(callback: () => void, ms: number) {
      next += 1;
      pending.set(next, { at: now + ms, callback });
      return next;
    },
    clear(handle: unknown) {
      pending.delete(handle as number);
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
    pending: () => pending.size,
  };
}

function setup() {
  const indicator = { show: vi.fn(), hide: vi.fn(), stopped: vi.fn() };
  const timers = fakeTimers();
  const use = createComputerUse({ indicator, lingerMs: 1_000, timers });
  const calls: Array<ReturnType<typeof deferred<unknown>> & { signal: AbortSignal }> = [];
  const screen: HostScreen = {
    observe: vi.fn((scope) => {
      const call = Object.assign(deferred<unknown>(), { signal: scope.signal });
      calls.push(call);
      return call.promise as never;
    }),
    act: vi.fn(async () => ({ completed: 1 })),
    close: vi.fn(async () => undefined),
  };
  const wrapped = use.wrap(screen);
  const scope = (runId?: string, botId = "bot-1") => ({
    botId,
    ...(runId ? { runId } : {}),
    signal: new AbortController().signal,
  });
  return { indicator, timers, use, screen, wrapped, calls, scope };
}

describe("computer use indicator", () => {
  it("shows on the first action and hides a moment after the last", async () => {
    const { indicator, timers, wrapped, calls, scope } = setup();
    const first = wrapped.observe(scope("run-1"), "Notes");
    const second = wrapped.observe(scope("run-1"), "Mail");
    expect(indicator.show).toHaveBeenCalledOnce();
    calls[0]!.resolve({ app: "Notes", tree: "" });
    await first;
    timers.advance(5_000);
    // Still busy with the second call.
    expect(indicator.hide).not.toHaveBeenCalled();
    calls[1]!.resolve({ app: "Mail", tree: "" });
    await second;
    timers.advance(999);
    expect(indicator.hide).not.toHaveBeenCalled();
    timers.advance(1);
    expect(indicator.hide).toHaveBeenCalledOnce();
  });

  it("does not flicker when the next action starts within the linger", async () => {
    const { indicator, timers, wrapped, scope } = setup();
    await wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }]);
    timers.advance(500);
    await wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }]);
    timers.advance(900);
    expect(indicator.show).toHaveBeenCalledOnce();
    expect(indicator.hide).not.toHaveBeenCalled();
    timers.advance(100);
    expect(indicator.hide).toHaveBeenCalledOnce();
    await wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }]);
    expect(indicator.show).toHaveBeenCalledTimes(2);
  });
});

describe("stop", () => {
  it("aborts the action in flight at once and refuses the run afterwards", async () => {
    const { indicator, use, wrapped, calls, scope, screen } = setup();
    const running = wrapped.observe(scope("run-1"), "Mail");
    const outcome = running.catch((error: Error) => error);
    expect(use.stop()).toBe(1);
    // The driver never answered, yet the call ends now.
    expect(((await outcome) as Error).message).toBe(HOST_SCREEN_STOPPED_MESSAGE);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(indicator.stopped).toHaveBeenCalledOnce();
    expect(indicator.hide).not.toHaveBeenCalled();
    await expect(wrapped.act(scope("run-1"), "Mail", [{ kind: "wait", ms: 0 }])).rejects.toThrow(
      HOST_SCREEN_STOPPED_MESSAGE,
    );
    expect(screen.act).not.toHaveBeenCalled();
    // Another run is not affected.
    await expect(
      wrapped.act(scope("run-2"), "Mail", [{ kind: "wait", ms: 0 }]),
    ).resolves.toMatchObject({ completed: 1 });
  });

  it("also stops a run that is between two actions", async () => {
    const { use, wrapped, timers, scope } = setup();
    await wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }]);
    timers.advance(COMPUTER_USE_RECENT_MS - 1);
    expect(use.stop()).toBe(1);
    await expect(wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }])).rejects.toThrow(
      HOST_SCREEN_STOPPED_MESSAGE,
    );
  });

  it("forgets runs that finished long ago", async () => {
    const { use, wrapped, timers, scope } = setup();
    await wrapped.act(scope("run-1"), "Notes", [{ kind: "wait", ms: 0 }]);
    timers.advance(COMPUTER_USE_RECENT_MS + 1);
    expect(use.stop()).toBe(0);
  });

  it("refuses a bot without a run id only briefly", async () => {
    const { use, wrapped, timers, scope } = setup();
    await wrapped.act(scope(), "Notes", [{ kind: "wait", ms: 0 }]);
    use.stop();
    await expect(wrapped.act(scope(), "Notes", [{ kind: "wait", ms: 0 }])).rejects.toThrow(
      HOST_SCREEN_STOPPED_MESSAGE,
    );
    timers.advance(STOPPED_BOT_MS);
    await expect(wrapped.act(scope(), "Notes", [{ kind: "wait", ms: 0 }])).resolves.toMatchObject({
      completed: 1,
    });
  });

  it("passes a server-side cancel through as the run's own abort", async () => {
    const { wrapped, calls } = setup();
    const controller = new AbortController();
    const running = wrapped.observe({ botId: "b", runId: "r", signal: controller.signal }, "Mail");
    const outcome = running.catch((error: unknown) => error);
    controller.abort(new Error("run cancelled"));
    expect(((await outcome) as Error).message).toBe("run cancelled");
    expect(calls[0]!.signal.aborted).toBe(true);
  });
});

describe("stop shortcut", () => {
  it("never uses Task Manager's key on Windows", () => {
    for (const platform of ["win32", "linux", "darwin"] as const)
      for (const { accelerator } of stopShortcutCandidates(platform))
        expect(accelerator).not.toBe("Control+Shift+Escape");
  });

  it("holds the first free key, releases it, and falls back when one is taken", () => {
    const owned = new Set<string>();
    const registry = {
      register: vi.fn((accelerator: string) => {
        if (accelerator === "Command+Shift+Escape") return false;
        owned.add(accelerator);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => owned.delete(accelerator)),
    };
    const onStop = vi.fn();
    const shortcut = stopShortcut(registry, "darwin", onStop);
    expect(shortcut.hold()).toBe("⌘⌥⇧S");
    expect(shortcut.hold()).toBe("⌘⌥⇧S");
    expect(registry.register).toHaveBeenCalledTimes(2);
    expect(registry.register).toHaveBeenLastCalledWith("Command+Option+Shift+S", onStop);
    shortcut.release();
    expect(owned.size).toBe(0);
    shortcut.release();
    expect(registry.unregister).toHaveBeenCalledOnce();
  });

  it("holds nothing when every key is taken or registering throws", () => {
    const shortcut = stopShortcut(
      {
        register: () => {
          throw new Error("taken");
        },
        unregister: vi.fn(),
      },
      "win32",
      vi.fn(),
    );
    expect(shortcut.hold()).toBeNull();
    expect(shortcut.label()).toBe("Ctrl+Alt+Esc");
  });
});

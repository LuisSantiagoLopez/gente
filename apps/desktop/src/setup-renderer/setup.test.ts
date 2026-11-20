// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DesktopLocalStackState,
  DesktopReachability,
  DesktopSetup,
  DesktopSetupState,
  RakazoSetup,
} from "@rakazo/contracts";
import type { Deferred } from "@rakazo/core/test-async";
import { deferred } from "@rakazo/core/test-async";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ES_MESSAGES } from "../main/locales/es.js";
import { HE_MESSAGES } from "../main/locales/he.js";
import { PL_MESSAGES } from "../main/locales/pl.js";

type DesktopSetupResult = Awaited<ReturnType<RakazoSetup["save"]>>;

const DEFAULT_LOCAL_URL = "http://127.0.0.1:6130";
const CLOUD_URL = "https://cloud.rakazo.example";
const ENGLISH: RakazoSetup["locale"] = { lang: "en", dir: "ltr", messages: {} };

// The jsdom environment replaces the global URL, so resolve the sibling files via Node's.
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const setupBody = readFileSync(path.join(srcDir, "setup.html"), "utf8").match(
  /<body>([\s\S]*)<\/body>/,
)?.[1];
const setupScript = readFileSync(path.join(srcDir, "setup.js"), "utf8");

function stackState(phase: DesktopLocalStackState["phase"]): DesktopLocalStackState {
  return { phase, message: null, output: [], layerBytes: {}, imageTag: "v0.0.0" };
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`setup.html is missing #${id}`);
  return node as T;
}

/** Pumps the microtask queue so the script's await chains advance without timers. */
async function flush(ticks = 30): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

function selectMode(mode: "cloud" | "new" | "existing"): void {
  const input = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (input === null) throw new Error(`setup.html is missing the ${mode} mode input`);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function submitForm(): void {
  element<HTMLFormElement>("setup").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

interface Harness {
  /** The oldest pending `test` call's deferred, for settling one check by handle. */
  nextCheck: () => Deferred<DesktopReachability>;
  /** Resolves the oldest pending `test` call, in call order. */
  resolveCheck: (result: DesktopReachability) => void;
  /** What every `stack.start` call this mount receives resolves with. */
  startResult: Deferred<DesktopLocalStackState>;
  /** How many times `stack.start` was called. */
  starts: () => number;
  /** Links passed to `openLink`. */
  links: string[];
  /** Resolves the oldest pending `state` call, in call order. */
  resolveAppState: (saved: DesktopSetup | null) => void;
  /** Resolves the oldest pending `stack.state` call, in call order. */
  resolveStackState: (state: DesktopLocalStackState) => void;
  /** Rejects the oldest pending `stack.state` call. */
  rejectStackState: (reason: unknown) => void;
  /** Delivers a pushed stack state the way the `desktop.setup.stack.changed` push does. */
  pushStackState: (state: DesktopLocalStackState) => void;
  /** Payloads received by `save`. */
  saves: DesktopSetup[];
  /** Resolves the oldest pending `save` call, in call order. */
  resolveSave: (result: DesktopSetupResult) => void;
}

function mount(saved: DesktopSetup | null, locale = ENGLISH, platform = "linux"): Harness {
  document.body.innerHTML = setupBody ?? "";
  const checkCalls: Array<Deferred<DesktopReachability>> = [];
  const startResult = deferred<DesktopLocalStackState>();
  const stateCalls: Array<Deferred<DesktopSetupState>> = [];
  const stackStateCalls: Array<Deferred<DesktopLocalStackState>> = [];
  const pushListeners: Array<(state: DesktopLocalStackState) => void> = [];
  const saves: DesktopSetup[] = [];
  const saveCalls: Array<Deferred<DesktopSetupResult>> = [];
  const links: string[] = [];
  let starts = 0;

  const bridge: RakazoSetup = {
    platform,
    locale,
    state: () => {
      const call = deferred<DesktopSetupState>();
      stateCalls.push(call);
      return call.promise;
    },
    test: () => {
      const call = deferred<DesktopReachability>();
      checkCalls.push(call);
      return call.promise;
    },
    save: (setup) => {
      saves.push(setup);
      const call = deferred<DesktopSetupResult>();
      saveCalls.push(call);
      return call.promise;
    },
    quit: () => Promise.resolve(),
    openLink: (link) => {
      links.push(link);
      return Promise.resolve();
    },
    // Gente: the model step. Already ready here, so these tests exercise the workspace step.
    brain: {
      state: () =>
        Promise.resolve({
          phase: "ready",
          model: { tag: "swift", alias: "swift-1.5-27b", name: "Swift", sizeGB: 8.9, note: "" },
          models: [],
          completedBytes: 0,
          totalBytes: 0,
          message: "",
        }),
      start: () => Promise.resolve(undefined),
      onChange: () => undefined,
    },
    stack: {
      state: () => {
        const call = deferred<DesktopLocalStackState>();
        stackStateCalls.push(call);
        return call.promise;
      },
      start: () => {
        starts += 1;
        return startResult.promise;
      },
      onChange: (listener) => {
        pushListeners.push(listener);
      },
    },
  };
  (window as { rakazoSetup?: RakazoSetup }).rakazoSetup = bridge;
  // Run the plain script the same way setup.html's script tag does.
  new Function(setupScript)();

  const initState = stateCalls.shift();
  initState?.resolve({ defaultLocalUrl: DEFAULT_LOCAL_URL, cloudUrl: CLOUD_URL, saved });
  return {
    nextCheck: () => {
      const call = checkCalls.shift();
      if (call === undefined) throw new Error("no connection check is pending");
      return call;
    },
    resolveCheck: (result) => checkCalls.shift()?.resolve(result),
    startResult,
    starts: () => starts,
    links,
    resolveAppState: (next) =>
      stateCalls
        .shift()
        ?.resolve({ defaultLocalUrl: DEFAULT_LOCAL_URL, cloudUrl: CLOUD_URL, saved: next }),
    resolveStackState: (state) => stackStateCalls.shift()?.resolve(state),
    rejectStackState: (reason) => stackStateCalls.shift()?.reject(reason),
    pushStackState: (state) => {
      for (const listener of pushListeners) listener(state);
    },
    saves,
    resolveSave: (result) => saveCalls.shift()?.resolve(result),
  };
}

/** Loads the page and lets init settle on an idle stack. */
async function boot(
  saved: DesktopSetup | null,
  locale = ENGLISH,
  platform = "linux",
): Promise<Harness> {
  const ui = mount(saved, locale, platform);
  await flush();
  // Gente: init reads the model step first, so the page asks for its state a little later.
  ui.resolveAppState(saved);
  await flush(); // init reaches its stack.state call only after its state await resumes
  ui.resolveStackState(stackState("idle"));
  await flush();

  return ui;
}

// Gente: the setup page was redesigned for beginners (one screen, starts by itself, no Docker or
// cloud mode), so the upstream page's flows were replaced by these.
describe("Your AI setup", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete (window as { rakazoSetup?: RakazoSetup }).rakazoSetup;
  });

  it("starts by itself on a first run: no click before sign-up", async () => {
    const ui = await boot(null);
    await flush();
    expect(ui.starts()).toBe(1);
  });

  it("does not restart on its own when a setup was saved before", async () => {
    const ui = await boot({ mode: "new", serverUrl: DEFAULT_LOCAL_URL });
    expect(ui.starts()).toBe(0);
    expect(element<HTMLButtonElement>("continue").disabled).toBe(false);
  });

  it("names no tool a beginner wouldn't know", async () => {
    await boot(null);
    const visible = document.body.innerText ?? document.body.textContent ?? "";
    expect(visible).not.toMatch(/Ollama|LM Studio|Docker|OrbStack/);
  });

  it("shows the promises in the app's language", async () => {
    await boot(null, { lang: "es", dir: "ltr", messages: ES_MESSAGES });
    expect(document.querySelector(".heading")?.textContent).toBe("La IA de la gente.");
    expect(document.querySelector(".benefits")?.textContent).toContain(
      ES_MESSAGES["No ads. Ever."]!,
    );
  });

  it("lays out right to left for Hebrew", async () => {
    await boot(null, { lang: "he", dir: "rtl", messages: HE_MESSAGES });
    expect(document.documentElement.dir).toBe("rtl");
  });
});

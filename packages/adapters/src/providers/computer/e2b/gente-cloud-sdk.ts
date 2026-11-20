// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Bots' cloud computers through Gente Cloud, with no E2B key on the person's computer.
// The desktop app runs a loopback broker (GENTE_COMPUTER_BROKER_URL, secret path) that starts a
// metered session at Gente Cloud (/v1/sessions), keeps it alive with heartbeats while it runs and
// stops it (billing stops with it). The session hands back a per-sandbox envd token, which is all
// this server needs to run commands and read files on that computer.
import type {
  RemoteDesktop,
  RemoteDesktopSdk,
} from "../../../computers/sandbox/remote-desktop-sandbox.js";

interface BrokerSession {
  sessionId: string;
  connection: { sandboxId: string; envdAccessToken: string; domain: string; envdVersion?: string };
}

type Fetch = typeof fetch;

export function genteCloudBrokerUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GENTE_COMPUTER_BROKER_URL?.trim() || null;
}

const DISPLAY = ":0";

type RunOpts = { envs?: Record<string, string>; [option: string]: unknown };
type ScreenDesktop = {
  commands: { run(command: string, opts?: RunOpts): Promise<{ exitCode: number }> };
  _start(display: string, opts: { resolution: [number, number] }): Promise<void>;
};

/**
 * The screen of a computer made by Gente Cloud. `Sandbox.create` would set DISPLAY for every
 * command and start the screen (Xvfb and the desktop); attaching to a computer made elsewhere does
 * neither, so mouse moves, clicks and screenshots fail with "Can't open display". Do both here.
 */
export async function startScreen(sandbox: ScreenDesktop): Promise<void> {
  const run = sandbox.commands.run.bind(sandbox.commands);
  sandbox.commands.run = (command: string, opts: RunOpts = {}) =>
    run(command, { ...opts, envs: { DISPLAY, ...opts.envs } });
  // The probe exits non-zero (and the SDK rejects) when there is no screen yet: then start one.
  const screenUp = await run(`xdpyinfo -display ${DISPLAY}`, { envs: { DISPLAY } }).then(
    (probe) => probe.exitCode === 0,
    () => false,
  );
  if (!screenUp) await sandbox._start(DISPLAY, { resolution: [1024, 768] });
}

/** Wraps an envd-only connection: lifecycle belongs to Gente Cloud, so setTimeout does nothing. */
async function attach(session: BrokerSession): Promise<RemoteDesktop> {
  const { Sandbox } = await import("@e2b/desktop");
  const SandboxClass = Sandbox as unknown as new (opts: Record<string, unknown>) => RemoteDesktop;
  const sandbox = new SandboxClass({
    sandboxId: session.connection.sandboxId,
    sandboxDomain: session.connection.domain,
    envdAccessToken: session.connection.envdAccessToken,
    envdVersion: session.connection.envdVersion ?? "0.4.0",
  });
  await startScreen(sandbox as unknown as ScreenDesktop);
  return Object.assign(sandbox, {
    // Gente Cloud holds the lease and heartbeats it; the computer's own timer stays untouched.
    setTimeout: async () => undefined,
  });
}

export function genteCloudSdk(brokerUrl: string, fetchImpl: Fetch = fetch): RemoteDesktopSdk {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(`${brokerUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      const error = new Error(data.message ?? `Gente Cloud computer: ${data.error ?? res.status}`);
      (error as Error & { code?: string }).code = data.error;
      throw error;
    }
    return (await res.json()) as T;
  };
  return {
    async create() {
      return attach(await call<BrokerSession>("/sessions", { vendor: "e2b", taskKind: "desktop" }));
    },
    async connect(id) {
      return attach(await call<BrokerSession>(`/sessions/by-sandbox/${encodeURIComponent(id)}`));
    },
    async isRunning(id) {
      const state = await call<{ running: boolean }>(
        `/sessions/by-sandbox/${encodeURIComponent(id)}/state`,
      ).catch(() => ({ running: false }));
      return state.running;
    },
    async pause(id) {
      // Stopping the session ends billing; the next start gets a fresh session.
      return call(`/sessions/by-sandbox/${encodeURIComponent(id)}/stop`, {});
    },
    async kill(id) {
      await call(`/sessions/by-sandbox/${encodeURIComponent(id)}/stop`, {});
      return true;
    },
  } as RemoteDesktopSdk;
}

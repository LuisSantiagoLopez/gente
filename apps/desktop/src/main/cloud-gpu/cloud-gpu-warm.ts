// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// The warm pool: while the person is using Your AI with Cloud GPU on, Modal keeps one spare GPU
// ready, so a new chat never waits about 20 s for a cold start. The app holds a 15-minute lease
// and renews it on activity (the switch, typing, each answer). With no activity for 15 minutes,
// or when the switch goes off or the app quits, the spare is let go; if the app crashes, the lease
// runs out on its own (control_app.py checks every 2 minutes).
// Cost: one idle H100 ($3.95/h) only while the person is active.
// Who calls it: cloud-gpu-toggle.ts (on, off, typing, quit) and cloud-gpu-route.ts (each answer).

export const LEASE_MINUTES = 15;
const RENEW_EVERY_MS = 5 * 60_000;

export interface WarmDeps {
  controlUrl: string;
  key: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createWarmPool(deps: WarmDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let renewedAt = 0;
  let warm = false;
  let lastActive = 0;

  async function post(minutes: number) {
    const key = await deps.key();
    if (!key) return;
    await doFetch(`${deps.controlUrl}/warm`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ minutes }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
  }

  return {
    /** The person did something: keep (or start) the spare GPU, renewing at most every 5 min. */
    activity() {
      lastActive = now();
      if (warm && now() - renewedAt < RENEW_EVERY_MS) return;
      warm = true;
      renewedAt = now();
      void post(LEASE_MINUTES);
    },
    /** Called every minute: an idle person's lease is ended early instead of running out. */
    tick() {
      if (warm && now() - lastActive > LEASE_MINUTES * 60_000) return this.off();
    },
    async off() {
      if (!warm) return;
      warm = false;
      await post(0);
    },
    isWarm: () => warm,
  };
}

export type WarmPool = ReturnType<typeof createWarmPool>;

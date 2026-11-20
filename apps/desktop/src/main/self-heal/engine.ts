// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente's self-healing engine. Every failure in the catalog has a detector that runs on its own
// clock (every 2 s for what blocks a reply, longer for the rest) and a repair ladder that starts
// with the cheapest fix: retry, reconnect, restart one service, reset the stack, download again,
// switch between cloud and this computer. After every step the engine checks again; it stops at
// the first step that works and writes one plain sentence to the timeline. Nothing here knows how
// a service is started: the catalog's steps call the environment it is given, so the same specs
// run against the real app and against the chaos suite's stand-ins.

export type Lang = "en" | "es" | "pt";
export type Copy = Record<Lang, string>;

export type Detection = { broken: boolean; detail?: string };

export type RepairStep<Env> = {
  /** Cheapest first: retry, reconnect, restart, reset, redownload, fallback. */
  kind: "retry" | "reconnect" | "restart" | "reset" | "redownload" | "fallback" | "report";
  id: string;
  /** What Gente did, finishing "…, so I ___": "restarted the assistant". */
  did: Copy;
  run: (env: Env) => Promise<void>;
  /** How long this step may take to show its effect before the next one is tried. */
  verifyWithinMs: number;
  /** Heavy steps (stack reset, downloads) never run two at a time. */
  heavy?: boolean;
};

export type FailureSpec<Env> = {
  id: string;
  component:
    | "model"
    | "workspace"
    | "database"
    | "worker"
    | "app"
    | "cloud"
    | "account"
    | "connections"
    | "disk"
    | "network"
    | "media";
  /** Blocks a reply or a running task: checked every couple of seconds. */
  critical: boolean;
  everyMs: number;
  /** Detections in a row before acting (2 for flappy signals). */
  confirm: number;
  /** Time to recover the chaos suite must beat, from fault to healthy. */
  budgetMs: number;
  detect: (env: Env) => Promise<Detection>;
  /**
   * How to tell it is healthy again, when that is not "the detector stops firing" (a detector that
   * reads log lines only sees each line once, so its silence proves nothing).
   */
  healthy?: (env: Env) => Promise<boolean>;
  ladder: RepairStep<Env>[];
  /** What happened, finishing "9:41: ___, so I …": "the assistant stopped responding". */
  what: Copy;
  /** Shown only when every step failed; null keeps Gente quiet (it keeps trying). */
  calm: Copy | null;
};

export type HealEvent = {
  at: string;
  failureId: string;
  detail?: string;
  /** "reported": nothing on this computer can fix it; Gente Cloud or an update will. */
  outcome: "fixed" | "reported" | "needs-person" | "still-trying";
  /** The steps tried, in order, and the one that worked. */
  tried: string[];
  fixedBy?: string;
  ms: number;
};

type Status = {
  streak: number;
  healing: boolean;
  cooldownUntil: number;
  failures: number;
  lastCheck: number;
};

export type EngineOptions<Env> = {
  env: Env;
  specs: readonly FailureSpec<Env>[];
  onEvent?: (event: HealEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How often the engine looks at its clocks. Each spec still runs on its own `everyMs`. */
  tickMs?: number;
  /** Polling while a step settles. */
  pollMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HealEngine<Env> {
  private readonly status = new Map<string, Status>();
  private heavyRunning = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly events: HealEvent[] = [];

  constructor(private readonly options: EngineOptions<Env>) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    for (const spec of options.specs)
      this.status.set(spec.id, {
        streak: 0,
        healing: false,
        cooldownUntil: 0,
        failures: 0,
        lastCheck: -Infinity,
      });
  }

  start() {
    const tick = this.options.tickMs ?? 500;
    this.timer = setInterval(() => void this.tick(), tick);
    this.timer.unref?.();
    return () => clearInterval(this.timer);
  }

  /** Runs every detector whose clock is due. Public so tests and the chaos suite drive it. */
  async tick(): Promise<void> {
    const now = this.now();
    await Promise.all(
      this.options.specs.map(async (spec) => {
        const s = this.status.get(spec.id) as Status;
        if (s.healing || now - s.lastCheck < spec.everyMs || now < s.cooldownUntil) return;
        s.lastCheck = now;
        await this.check(spec);
      }),
    );
  }

  /** Checks one failure now and repairs it if it is broken. */
  async check(spec: FailureSpec<Env>): Promise<HealEvent | null> {
    const s = this.status.get(spec.id) as Status;
    if (s.healing) return null;
    const found = await spec.detect(this.options.env).catch(() => ({ broken: false }) as Detection);
    if (!found.broken) {
      s.streak = 0;
      s.failures = 0;
      return null;
    }
    if (++s.streak < spec.confirm) return null;
    s.healing = true;
    try {
      return await this.repair(spec, found);
    } finally {
      s.healing = false;
      s.streak = 0;
    }
  }

  private async healthyWithin(spec: FailureSpec<Env>, ms: number): Promise<boolean> {
    const pollMs = this.options.pollMs ?? 250;
    const deadline = this.now() + ms;
    for (;;) {
      const ok = spec.healthy
        ? await spec.healthy(this.options.env).catch(() => false)
        : !(await spec.detect(this.options.env).catch(() => ({ broken: true }) as Detection))
            .broken;
      if (ok) return true;
      if (this.now() >= deadline) return false;
      await this.sleep(pollMs);
    }
  }

  private async repair(spec: FailureSpec<Env>, found: Detection): Promise<HealEvent> {
    const s = this.status.get(spec.id) as Status;
    const started = this.now();
    const tried: string[] = [];
    for (const step of spec.ladder) {
      if (step.heavy) {
        while (this.heavyRunning) await this.sleep(this.options.pollMs ?? 250);
        this.heavyRunning = true;
      }
      tried.push(step.id);
      try {
        await step.run(this.options.env);
      } catch {
        // A step that throws simply did not work; the next one is tried.
      } finally {
        if (step.heavy) this.heavyRunning = false;
      }
      if (step.kind === "report")
        return this.record(spec, {
          outcome: "reported",
          tried,
          fixedBy: step.id,
          ms: this.now() - started,
          detail: found.detail,
        });
      if (await this.healthyWithin(spec, step.verifyWithinMs)) {
        return this.record(spec, {
          outcome: "fixed",
          tried,
          fixedBy: step.id,
          ms: this.now() - started,
          detail: found.detail,
        });
      }
    }
    // Every step was tried. Wait longer each time before the next full round.
    s.failures++;
    s.cooldownUntil = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (s.failures - 1));
    return this.record(spec, {
      outcome: spec.calm ? "needs-person" : "still-trying",
      tried,
      ms: this.now() - started,
      detail: found.detail,
    });
  }

  private record(spec: FailureSpec<Env>, partial: Omit<HealEvent, "at" | "failureId">): HealEvent {
    const event: HealEvent = {
      at: new Date(this.now()).toISOString(),
      failureId: spec.id,
      ...partial,
    };
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    this.options.onEvent?.(event);
    return event;
  }
}

/** One plain sentence for the "Gente fixed itself" timeline. */
export function describeHealEvent<Env>(
  event: HealEvent,
  specs: readonly FailureSpec<Env>[],
  lang: Lang,
  timeZone?: string,
): string {
  const spec = specs.find((s) => s.id === event.failureId);
  if (!spec) return "";
  const time = new Date(event.at).toLocaleTimeString(lang === "en" ? "en-US" : lang, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
  const secs = Math.max(1, Math.round(event.ms / 1000));
  const step = spec.ladder.find((s) => s.id === event.fixedBy);
  const so = { en: "so I", es: "así que", pt: "então eu" }[lang];
  if ((event.outcome === "fixed" || event.outcome === "reported") && step)
    return `${time}: ${spec.what[lang]}, ${so} ${step.did[lang]} (${secs} s).`;
  const tried = {
    en: "I'm still working on it.",
    es: "Sigo trabajando en ello.",
    pt: "Ainda estou resolvendo.",
  }[lang];
  return `${time}: ${spec.what[lang]}. ${spec.calm?.[lang] ?? tried}`;
}

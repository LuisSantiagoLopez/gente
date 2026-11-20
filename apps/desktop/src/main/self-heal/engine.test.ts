// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, describe as group, it } from "vitest";
import { CATALOG } from "./catalog.js";
import type { FailureSpec, HealEvent } from "./engine.js";
import { describe, HealEngine } from "./engine.js";

type Env = { broken: boolean; log: string[] };
const c = (en: string) => ({ en, es: en, pt: en });

function spec(over: Partial<FailureSpec<Env>> = {}): FailureSpec<Env> {
  return {
    id: "thing",
    component: "app",
    critical: true,
    everyMs: 0,
    confirm: 1,
    budgetMs: 1_000,
    detect: async (env) => ({ broken: env.broken }),
    ladder: [
      {
        kind: "retry",
        id: "retry",
        did: c("tried again"),
        run: async (env) => void env.log.push("retry"),
        verifyWithinMs: 0,
      },
      {
        kind: "restart",
        id: "restart",
        did: c("restarted it"),
        run: async (env) => {
          env.log.push("restart");
          env.broken = false;
        },
        verifyWithinMs: 0,
      },
    ],
    what: c("it stopped"),
    calm: c("It needs you."),
    ...over,
  };
}

const run = async (s: FailureSpec<Env>, env: Env) => {
  const events: HealEvent[] = [];
  const engine = new HealEngine({
    env,
    specs: [s],
    onEvent: (e) => events.push(e),
    sleep: async () => {},
    pollMs: 0,
  });
  await engine.check(s);
  return events;
};

group("self-heal engine", () => {
  it("tries the cheapest step first and stops at the first that works, checking after each", async () => {
    const env = { broken: true, log: [] as string[] };
    const [event] = await run(spec(), env);
    expect(env.log).toEqual(["retry", "restart"]);
    expect(event).toMatchObject({
      outcome: "fixed",
      fixedBy: "restart",
      tried: ["retry", "restart"],
    });
  });

  it("does nothing while healthy", async () => {
    const env = { broken: false, log: [] as string[] };
    expect(await run(spec(), env)).toEqual([]);
    expect(env.log).toEqual([]);
  });

  it("waits for repeated detections when a signal is flappy", async () => {
    const env = { broken: true, log: [] as string[] };
    const s = spec({ confirm: 2 });
    const engine = new HealEngine({ env, specs: [s], sleep: async () => {}, pollMs: 0 });
    expect(await engine.check(s)).toBeNull();
    expect(await engine.check(s)).toMatchObject({ outcome: "fixed" });
  });

  it("says it needs the person only when every step failed, and keeps quiet when there is no calm line", async () => {
    const never = spec({
      ladder: [
        { kind: "retry", id: "retry", did: c("tried"), run: async () => {}, verifyWithinMs: 0 },
      ],
    });
    expect((await run(never, { broken: true, log: [] }))[0]?.outcome).toBe("needs-person");
    expect((await run({ ...never, calm: null }, { broken: true, log: [] }))[0]?.outcome).toBe(
      "still-trying",
    );
  });

  it("records a report step as reported, never as fixed", async () => {
    const report = spec({
      ladder: [
        {
          kind: "report",
          id: "tell",
          did: c("told the team"),
          run: async () => {},
          verifyWithinMs: 0,
        },
      ],
    });
    expect((await run(report, { broken: true, log: [] }))[0]).toMatchObject({
      outcome: "reported",
      fixedBy: "tell",
    });
  });

  it("writes the timeline in plain words", () => {
    const s = spec();
    const text = describe(
      {
        at: "2026-11-20T17:41:00Z",
        failureId: "thing",
        outcome: "fixed",
        tried: ["retry", "restart"],
        fixedBy: "restart",
        ms: 4_200,
      },
      [s],
      "en",
      "UTC",
    );
    expect(text).toBe("5:41 PM: it stopped, so I restarted it (4 s).");
  });
});

group("failure catalog", () => {
  it("has a detector, a ladder and copy in every language for every failure", () => {
    const ids = new Set<string>();
    for (const s of CATALOG) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.ladder.length, s.id).toBeGreaterThan(0);
      for (const lang of ["en", "es", "pt"] as const) {
        expect(s.what[lang], `${s.id} ${lang}`).toBeTruthy();
        for (const step of s.ladder)
          expect(step.did[lang], `${s.id}/${step.id} ${lang}`).toBeTruthy();
        if (s.calm) expect(s.calm[lang]).toBeTruthy();
      }
      // What blocks a reply is checked every second or two and must recover within 10 s.
      if (s.critical) {
        expect(s.everyMs, s.id).toBeLessThanOrEqual(2_000);
        expect(s.budgetMs, s.id).toBeLessThanOrEqual(10_000);
      }
    }
  });

  it("matches the reviewed snapshot: removing a repair step or loosening a budget is a visible change", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "catalog.snapshot.json"), "utf8"),
    );
    const now = Object.fromEntries(
      CATALOG.map((s) => [
        s.id,
        { everyMs: s.everyMs, budgetMs: s.budgetMs, ladder: s.ladder.map((step) => step.id) },
      ]),
    );
    expect(now).toEqual(snapshot);
  });
});

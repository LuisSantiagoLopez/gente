// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests the warm pool lease: kept while active, let go when idle or off.
import { describe, expect, it } from "vitest";
import { createWarmPool } from "./cloud-gpu-warm.js";

function make() {
  const sent: number[] = [];
  let t = 0;
  const pool = createWarmPool({
    controlUrl: "https://control.example",
    key: async () => "k",
    now: () => t,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).minutes);
      return Response.json({});
    }) as typeof fetch,
  });
  return { pool, sent, advance: (ms: number) => (t += ms) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Cloud GPU warm pool", () => {
  it("asks for a spare GPU on activity and renews at most every 5 minutes", async () => {
    const { pool, sent, advance } = make();
    pool.activity();
    advance(60_000);
    pool.activity();
    advance(5 * 60_000);
    pool.activity();
    await settle();
    expect(sent).toEqual([15, 15]);
  });

  it("lets the spare go after 15 idle minutes, and when switched off", async () => {
    const { pool, sent, advance } = make();
    pool.activity();
    advance(10 * 60_000);
    await pool.tick();
    expect(pool.isWarm()).toBe(true);
    advance(6 * 60_000);
    await pool.tick();
    expect(pool.isWarm()).toBe(false);
    pool.activity();
    await pool.off();
    await settle();
    expect(sent).toEqual([15, 0, 15, 0]);
  });
});

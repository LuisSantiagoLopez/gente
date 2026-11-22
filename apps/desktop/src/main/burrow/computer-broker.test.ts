// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import { startComputerBroker } from "./computer-broker.js";

describe("cloud computers through Your AI Cloud", () => {
  it("starts a session, hands back only the computer's own token, and stops billing on stop", async () => {
    const cloud = {
      startSession: vi.fn(async () => ({
        sessionId: "s1",
        leaseUntil: "",
        heartbeatEverySeconds: 30,
        connection: { sandboxId: "sb1", envdAccessToken: "envd", domain: "e2b.app" },
      })),
      heartbeat: vi.fn(async () => ({ leaseUntil: "" })),
      stopSession: vi.fn(async () => undefined),
    };
    const broker = await startComputerBroker(() => cloud as never);
    try {
      const started = await (
        await fetch(`${broker.url}/sessions`, { method: "POST", body: "{}" })
      ).json();
      expect(started).toEqual({
        sessionId: "s1",
        connection: { sandboxId: "sb1", envdAccessToken: "envd", domain: "e2b.app" },
      });
      expect(JSON.stringify(started)).not.toMatch(/api.?key/i);
      expect(await (await fetch(`${broker.url}/sessions/by-sandbox/sb1/state`)).json()).toEqual({
        running: true,
      });
      await fetch(`${broker.url}/sessions/by-sandbox/sb1/stop`, { method: "POST", body: "{}" });
      expect(cloud.stopSession).toHaveBeenCalledWith("s1");
      expect(await (await fetch(`${broker.url}/sessions/by-sandbox/sb1/state`)).json()).toEqual({
        running: false,
      });
      expect(
        (await fetch(broker.url.replace(/\/[^/]+$/, "/wrong/sessions"), { method: "POST" })).status,
      ).toBe(404);
    } finally {
      await broker.closeAll();
    }
  });

  it("asks to sign in when there is no account, and passes on out-of-hours", async () => {
    const none = await startComputerBroker(() => null);
    expect((await fetch(`${none.url}/sessions`, { method: "POST", body: "{}" })).status).toBe(401);
    await none.closeAll();
    const out = Object.assign(new Error("No hours left"), { code: "out_of_credit", status: 402 });
    const broke = await startComputerBroker(
      () =>
        ({
          startSession: async () => {
            throw out;
          },
        }) as never,
    );
    const res = await fetch(`${broke.url}/sessions`, { method: "POST", body: "{}" });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("out_of_credit");
    await broke.closeAll();
  });
});

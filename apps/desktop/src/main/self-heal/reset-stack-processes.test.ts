// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Chaos: the "api-down" repairs (restart the API, reset the whole workspace) run over and over
// and at the same time, against real processes. Afterwards exactly one API and one worker live.
// Before the fix, a restart that finished during a reset started an API nobody owned; those
// filled the database's connections and tripped "api-down" again, in a loop.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ServiceSpec } from "../this-computer/native-stack.js";
import { Service, stopLeftoverChildren, strayServerPids } from "../this-computer/native-stack.js";
import { exclusiveRepair } from "../this-computer/repair-lock.js";
import type { HealEnv } from "./catalog.js";
import { CATALOG } from "./catalog.js";
import { HealEngine } from "./engine.js";

const marker = `yourai-chaos-${process.pid}-${Date.now()}`;
let dir = "";

/** The stack's own rules for its services, with real child processes standing in for the server. */
class TinyStack {
  services: Service[] = [];
  ready = false;

  private spec(name: string): ServiceSpec {
    return {
      name,
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)", `${marker}-${name}`],
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
      stopSignal: "SIGTERM",
    };
  }

  /** As NativeStackController: a reset retires every service, stops leftovers, starts fresh ones. */
  async reset() {
    this.ready = false;
    const old = this.services;
    this.services = [];
    await Promise.all(old.map((service) => service.retire(2_000)));
    await stopLeftoverChildren(2_000);
    for (const name of ["api", "worker"]) {
      const service = new Service(this.spec(name), {
        spawn: (command, args, options) =>
          spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] }),
        logDir: dir,
        runDir: dir,
        onCrash: () => this.ready,
      });
      this.services.push(service);
      service.start();
    }
    this.ready = true;
  }

  /**
   * As the old NativeStackController.restartService, with no guard of its own: the service's
   * restart must still never outlive a reset that retired it.
   */
  async restartService(name: string) {
    const service = this.services.find((s) => s.spec.name === name);
    return service ? service.restart() : false;
  }
}

function alive(name: string): number {
  const out = execFileSync("/bin/ps", ["-ww", "-axo", "command="], { encoding: "utf8" });
  return out.split("\n").filter((line) => line.includes(`${marker}-${name}`)).length;
}

afterAll(async () => {
  await stopLeftoverChildren(2_000);
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("reset-stack under chaos", () => {
  it("leaves exactly one API and one worker after three resets with restarts in between", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "yourai-chaos-"));
    const stack = new TinyStack();
    await stack.reset();
    let apiUp = false;
    const env = {
      apiUp: async () => apiUp,
      restartService: async (name: string) => {
        await stack.restartService(name);
      },
      resetStack: async () => {
        await stack.reset();
      },
    } as unknown as HealEnv;
    const apiDown = CATALOG.find((spec) => spec.id === "api-down")!;
    // The real "api-down" ladder, made quick: a restart that does not fix it, then the reset.
    const quick = {
      ...apiDown,
      confirm: 1,
      ladder: apiDown.ladder.map((step) => ({ ...step, verifyWithinMs: 0 })),
    };
    const engine = new HealEngine<HealEnv>({
      env,
      specs: [quick, { ...quick, id: "api-down-again" }],
      exclusive: exclusiveRepair,
      pollMs: 10,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    for (let round = 0; round < 3; round++) {
      // Both healers see the API down at once, and a second restart lands during the reset.
      await Promise.all([
        engine.tick(),
        engine.tick(),
        stack.restartService("api"),
        stack.restartService("api"),
      ]);
      await Promise.all([
        stack.reset(),
        stack.restartService("api"),
        stack.restartService("worker"),
      ]);
    }
    apiUp = true;
    expect(alive("api")).toBe(1);
    expect(alive("worker")).toBe(1);
  }, 120_000);
});

describe("stray servers on launch", () => {
  const binary = "/Applications/Your AI.app/Contents/MacOS/Your AI";
  const listing = [
    `  101 ${binary} /Applications/Your AI.app/Contents/Resources/rakazo-server/apps/api/dist/index.js`,
    `  102 ${binary} --max-semi-space-size=64 /Applications/Your AI.app/Contents/Resources/rakazo-server/apps/worker/dist/index.js`,
    `  103 ${binary} /Applications/Your AI.app/Contents/Resources/rakazo-server/apps/web/server.js`,
    `  104 ${binary} --remote-debugging-port=9333`,
    `  105 /usr/bin/node /somewhere/else/apps/api/dist/index.js`,
    `  106 ${binary} /Applications/Your AI.app/Contents/Resources/rakazo-server/apps/api/dist/index.js`,
  ].join("\n");

  it("finds only this app's API and worker processes it did not start", () => {
    expect(strayServerPids(listing, binary, new Set([106]), 104)).toEqual([101, 102]);
  });
});

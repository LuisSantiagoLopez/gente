// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { startScreen } from "./gente-cloud-sdk.js";

function fakeDesktop(screenUp: boolean) {
  const calls: { command: string; envs?: Record<string, string> }[] = [];
  const started: string[] = [];
  const desktop = {
    commands: {
      async run(command: string, opts: { envs?: Record<string, string> } = {}) {
        calls.push({ command, envs: opts.envs });
        return { exitCode: command.startsWith("xdpyinfo") && !screenUp ? 1 : 0 };
      },
    },
    async _start(display: string) {
      started.push(display);
    },
  };
  return { desktop: desktop as never, calls, started };
}

describe("a cloud computer's screen", () => {
  it("starts the screen when it is not running, and every command sees DISPLAY", async () => {
    const fake = fakeDesktop(false);
    await startScreen(fake.desktop);
    expect(fake.started).toEqual([":0"]);
    await (fake.desktop as { commands: { run(c: string): Promise<unknown> } }).commands.run(
      "xdotool mousemove 1 2",
    );
    expect(fake.calls.at(-1)).toEqual({
      command: "xdotool mousemove 1 2",
      envs: { DISPLAY: ":0" },
    });
  });

  it("leaves a running screen alone", async () => {
    const fake = fakeDesktop(true);
    await startScreen(fake.desktop);
    expect(fake.started).toEqual([]);
  });
});

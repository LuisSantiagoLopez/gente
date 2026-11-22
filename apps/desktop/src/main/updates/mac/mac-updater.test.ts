// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// The Mac updater behind the shared controller: up to date, newer found, and an app run from a
// DMG or a translocated path, which gets the one-click "Move to Applications" fix instead.
import { describe, expect, it, vi } from "vitest";
import { DesktopUpdateController } from "../auto-update.js";
import { blockedLocation, bundleFromExecPath } from "./install-location.js";
import { MacDmgUpdater } from "./mac-updater.js";
import { feedYaml } from "./test-fixtures.js";

vi.mock("../../system/monitoring.js", () => ({ reportDesktopError: vi.fn() }));

const feed = feedYaml("1.0.7", [{ url: "Your-AI-1.0.7-arm64.dmg", sha512: "x", size: 1 }]);

function controllerAt(execPath: string, current = "1.0.6", fetched = feed) {
  const updater = new MacDmgUpdater({
    currentVersion: current,
    bundleId: "com.gente.app",
    arch: "arm64",
    execPath,
    pid: 1,
    fetcher: async () => new Response(fetched),
    downloadDir: "/nonexistent/updates",
    statusFile: "/nonexistent/updates/last-install.txt",
    logFile: "/nonexistent/support.log",
    log: () => {},
    quit: vi.fn(),
    feed: "http://feed.test/latest-mac.yml",
  });
  return new DesktopUpdateController(
    { packaged: true, version: current },
    async () => updater,
    undefined,
    undefined,
    undefined,
    false,
  );
}

describe("install location", () => {
  it("finds the bundle from the executable path", () => {
    expect(bundleFromExecPath("/Applications/Your AI.app/Contents/MacOS/Your AI")).toBe(
      "/Applications/Your AI.app",
    );
    expect(bundleFromExecPath("/usr/bin/node")).toBeNull();
  });

  it("spots translocated and disk-image runs", () => {
    expect(blockedLocation("/private/var/folders/x/AppTranslocation/ABC/d/Your AI.app")).toBe(
      "translocated",
    );
    expect(blockedLocation("/Volumes/Your AI/Your AI.app")).toBe("disk-image");
    expect(blockedLocation("/Applications/Your AI.app")).toBeNull();
  });
});

describe("MacDmgUpdater with the controller", () => {
  it("offers the newer version without downloading until the click", async () => {
    const controller = controllerAt("/Applications/Your AI.app/Contents/MacOS/Your AI");
    const state = await controller.check(false);
    expect(state.phase).toBe("available");
    expect(state.availableVersion).toBe("1.0.7");
  });

  it("stays idle when the feed is not newer", async () => {
    const controller = controllerAt("/Applications/Your AI.app/Contents/MacOS/Your AI", "1.0.7");
    expect((await controller.check(true)).phase).toBe("idle");
  });

  it("asks to move to Applications when run from a disk image", async () => {
    const controller = controllerAt("/Volumes/Your AI/Your AI.app/Contents/MacOS/Your AI");
    await controller.check(true);
    const state = await controller.download();
    expect(state.phase).toBe("unsupported");
    expect(state.fix).toBe("move-to-applications");
    expect(state.message).toBe("Move Your AI to Applications to install updates.");
  });

  it("treats a missing feed as no releases yet, not an error", async () => {
    const updater = new MacDmgUpdater({
      currentVersion: "1.0.6",
      bundleId: "com.gente.app",
      arch: "arm64",
      execPath: "/Applications/Your AI.app/Contents/MacOS/Your AI",
      pid: 1,
      fetcher: async () => new Response("", { status: 404 }),
      downloadDir: "/nonexistent",
      statusFile: "/nonexistent/s",
      logFile: "/nonexistent/l",
      log: () => {},
      quit: vi.fn(),
    });
    const controller = new DesktopUpdateController(
      { packaged: true, version: "1.0.6" },
      async () => updater,
      undefined,
      undefined,
      undefined,
      false,
    );
    expect((await controller.check(false)).phase).toBe("unsupported");
  });
});

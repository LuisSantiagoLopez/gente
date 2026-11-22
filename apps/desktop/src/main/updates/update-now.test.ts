// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// The one Update button walks check -> download -> install and stops at the first failure.
import type { DesktopUpdateState } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { updateNow } from "./update-now.js";

const at = (phase: DesktopUpdateState["phase"]): DesktopUpdateState => ({
  phase,
  currentVersion: "1.0.6",
  availableVersion: phase === "idle" ? null : "1.0.7",
  percent: null,
  message: null,
  checkedAt: null,
});

function steps(
  start: DesktopUpdateState["phase"],
  after: Partial<Record<string, DesktopUpdateState["phase"]>>,
) {
  return {
    state: () => at(start),
    check: vi.fn(async () => at(after.check ?? "available")),
    download: vi.fn(async () => at(after.download ?? "ready")),
    install: vi.fn(async () => at("ready")),
  };
}

describe("updateNow", () => {
  it("runs every step from a found update", async () => {
    const s = steps("available", {});
    await updateNow(s);
    expect(s.check).not.toHaveBeenCalled();
    expect(s.download).toHaveBeenCalledOnce();
    expect(s.install).toHaveBeenCalledOnce();
  });

  it("Try again after a failure checks first", async () => {
    const s = steps("error", {});
    await updateNow(s);
    expect(s.check).toHaveBeenCalledOnce();
    expect(s.install).toHaveBeenCalledOnce();
  });

  it("installs straight away when already downloaded", async () => {
    const s = steps("ready", {});
    await updateNow(s);
    expect(s.download).not.toHaveBeenCalled();
    expect(s.install).toHaveBeenCalledOnce();
  });

  it("never installs after a failed download", async () => {
    const s = steps("available", { download: "error" });
    expect((await updateNow(s)).phase).toBe("error");
    expect(s.install).not.toHaveBeenCalled();
  });

  it("stops when nothing newer is found", async () => {
    const s = steps("idle", { check: "idle" });
    expect((await updateNow(s)).phase).toBe("idle");
    expect(s.download).not.toHaveBeenCalled();
  });
});

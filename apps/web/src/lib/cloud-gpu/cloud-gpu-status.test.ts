// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente. Tests the Cloud GPU status line words.
import { describe, expect, it } from "vitest";
import { CLOUD_PRIVACY_NOTE, cloudGpuLine } from "./cloud-gpu-status";

const base = { available: true, on: true, dollarsPerHour: 0 };

describe("Cloud GPU status line", () => {
  it("counts up while starting, then names the GPU, then is gone", () => {
    expect(cloudGpuLine({ ...base, status: { phase: "starting", since: 1000 } }, 3100)?.text).toBe(
      "Starting cloud GPU… 2.1 s",
    );
    expect(
      cloudGpuLine({ ...base, status: { phase: "on", gpu: "H100", startMs: 2100, sessions: 1 } }, 0)
        ?.text,
    ).toBe("Cloud GPU · H100");
    expect(cloudGpuLine({ ...base, status: { phase: "off" } }, 0)).toBeNull();
  });

  it("says plainly where messages go, without claiming they stay on this Mac", () => {
    expect(CLOUD_PRIVACY_NOTE).toMatch(/rented GPU used only by this chat/);
    expect(CLOUD_PRIVACY_NOTE).not.toMatch(/leaves|this Mac/i);
  });
});

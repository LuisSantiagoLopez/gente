// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
import { describe, expect, it } from "vitest";
import { detachedGuiOpener, OPENED_NOTE } from "./shell-gui-openers.js";

describe("window commands in the shell", () => {
  it("starts a single opener in the background and says how to look at it", () => {
    const out = detachedGuiOpener("cd ~/apps/x && xdg-open index.html");
    expect(out).toBe(
      `cd ~/apps/x && nohup xdg-open index.html >/dev/null 2>&1 &\nsleep 2; echo '${OPENED_NOTE}'`,
    );
    expect(detachedGuiOpener("google-chrome http://localhost:8000")).toContain(
      "nohup google-chrome",
    );
  });

  it("leaves everything else alone", () => {
    expect(detachedGuiOpener("ls -la")).toBeNull();
    expect(detachedGuiOpener("xdg-open a.html &")).toBeNull();
    expect(detachedGuiOpener("xdg-open a.html; echo hi")).toBeNull();
    expect(detachedGuiOpener("echo xdg-open")).toBeNull();
    expect(detachedGuiOpener("python3 -m http.server 8000")).toBeNull();
  });
});

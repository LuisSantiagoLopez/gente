// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PointerOverlay } from "./pointer-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as never;

describe("bot cursor and click highlight", () => {
  it("draws the cursor where the bot clicked and a ring for the click, only for its own bot", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<PointerOverlay botId="b1" screenWidth={1000} screenHeight={500} />),
    );
    const send = (botId: string) =>
      act(async () => {
        globalThis.dispatchEvent(
          new CustomEvent("gente:pointer", {
            detail: {
              botId,
              width: 1000,
              height: 500,
              points: [{ kind: "click", x: 250, y: 100 }],
            },
          }),
        );
      });
    await send("other");
    expect(host.querySelector(".gente-click-ripple")).toBeNull();
    await send("b1");
    const ring = host.querySelector<HTMLElement>(".gente-click-ripple")!;
    expect(ring.style.left).toBe("25%");
    expect(ring.style.top).toBe("20%");
    await act(async () => root.unmount());
  });
});

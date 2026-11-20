// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppLogo } from "./app-logo";
import { APP_LOGO_ICONS } from "./app-logo-icons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<() => void> = [];
afterEach(() => {
  for (const unmount of roots.splice(0)) act(() => unmount());
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(() => root.unmount());
  await act(async () => root.render(node));
  return host;
}
const fail = (img: HTMLImageElement) => act(async () => img.dispatchEvent(new Event("error")));

describe("an app's logo", () => {
  it("bundles a brand mark for common apps", () => {
    expect(Object.keys(APP_LOGO_ICONS).length).toBeGreaterThanOrEqual(80);
    for (const app of ["gmail", "googlecalendar", "notion", "figma", "discord", "googledrive"])
      expect(APP_LOGO_ICONS[app], app).toBeDefined();
  });

  it("uses the catalog logo first, then the bundled mark, and the letter only when nothing loads", async () => {
    const host = await render(
      <AppLogo name="Figma" logo="https://logos.test/figma.png" slug="figma" />,
    );
    const first = host.querySelector("img")!;
    expect(first.src).toBe("https://logos.test/figma.png");
    await fail(first);
    const second = host.querySelector("img")!;
    expect(second.src.startsWith("data:image/svg+xml,")).toBe(true);
    await fail(second);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("F");
  });

  it("finds the bundled mark by name when there is no catalog logo", async () => {
    const host = await render(<AppLogo name="Google Calendar" />);
    expect(host.querySelector("img")?.src.startsWith("data:image/svg+xml,")).toBe(true);
  });

  it("pads the logo inside a plate that never masks it", async () => {
    const host = await render(<AppLogo name="Notion" size={40} />);
    const tile = host.querySelector<HTMLElement>("[data-logo-tile]")!;
    expect(host.querySelector<HTMLElement>("[data-logo-box]")!.style.width).toBe("28px");
    expect(host.querySelector("img")!.className).toContain("h-full w-full");
    expect(host.querySelector("img")!.className).toContain("object-contain");
  });
});

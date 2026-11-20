// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
// @vitest-environment jsdom
import type { GenteLinkState } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createQueryRoot as createRoot } from "../query/query-root.test-support";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevicesSettingsPanel } from "./devices";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete (window as { rakazoDesktop?: unknown }).rakazoDesktop;
  document.body.innerHTML = "";
});

function bridge(initial: GenteLinkState) {
  let state = initial;
  const calls: string[] = [];
  (window as { rakazoDesktop?: unknown }).rakazoDesktop = {
    gente: {
      linkState: async () => state,
      linkStart: async () => {
        calls.push("start");
        state = { status: "waiting", qrImage: "data:image/png;base64,AAAA" };
        return state;
      },
      linkUnpair: async () => {
        calls.push("unpair");
        state = { status: "off" };
        return state;
      },
    },
  };
  return { calls, set: (next: GenteLinkState) => (state = next) };
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(<DevicesSettingsPanel />));
  return host;
}

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("Settings → Devices", () => {
  it("shows a QR code to scan, then the paired phone and the safety code, then unpairs", async () => {
    const fake = bridge({ status: "off" });
    const host = await mount();
    await act(async () => button(host, "Pair a phone").click());
    expect(fake.calls).toEqual(["start"]);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");

    fake.set({ status: "paired", code: "6488", phoneName: "Ana's iPhone" });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 2100)));
    expect(host.textContent).toContain("Paired with Ana's iPhone");
    expect(host.textContent).toContain("6488");

    await act(async () => button(host, "Unpair").click());
    expect(fake.calls).toEqual(["start", "unpair"]);
    expect(host.querySelector("[data-gente-devices]")?.getAttribute("data-gente-devices")).toBe(
      "off",
    );
  });

  it("asks to sign in first", async () => {
    bridge({ status: "signed_out" });
    const host = await mount();
    expect(host.textContent).toContain("Sign in to Gente to pair your phone.");
    expect(host.querySelector("button")).toBeNull();
  });
});

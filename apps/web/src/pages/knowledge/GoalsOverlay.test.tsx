// @vitest-environment jsdom
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { Goal, ProactiveAction, ProactiveDigest, ProactiveMetrics } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GoalsOverlay } from "./GoalsOverlay";

const api = vi.hoisted(() => ({
  goals: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  proactive: {
    settings: vi.fn(),
    updateSettings: vi.fn(),
    today: vi.fn(),
    metrics: vi.fn(),
    decide: vi.fn(),
    approve: vi.fn(),
    undo: vi.fn(),
  },
}));

vi.mock("../../lib/query/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));
vi.mock("@rakazo/ui-web", async () => {
  const { createElement } = await import("react");
  const container = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Dialog: container,
    DialogClose: container,
    DialogContent: container,
    DialogHeader: container,
    DialogTitle: container,
    Skeleton: () => createElement("div", { "data-skeleton": true }),
    Input: (props: { value?: string; onChange?: () => void; "aria-label"?: string }) =>
      createElement("input", {
        value: props.value,
        onChange: props.onChange,
        "aria-label": props["aria-label"],
      }),
    OptionSelect: (props: {
      value: string;
      options: { value: string; label: string }[];
      onValueChange: (value: string) => void;
      "aria-label"?: string;
    }) =>
      createElement(
        "select",
        {
          value: props.value,
          "aria-label": props["aria-label"],
          onChange: (event: { target: { value: string } }) =>
            props.onValueChange(event.target.value),
        },
        props.options.map((option) =>
          createElement("option", { key: option.value, value: option.value }, option.label),
        ),
      ),
    Button: (props: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      type?: "button" | "submit";
      "aria-label"?: string;
    }) =>
      createElement(
        "button",
        {
          type: props.type ?? "button",
          onClick: props.onClick,
          disabled: props.disabled,
          "aria-label": props["aria-label"],
        },
        props.children,
      ),
  };
});

const T = "2026-11-19T10:00:00.000Z";
const goal: Goal = {
  id: "g1",
  title: "Grow my Etsy sales",
  outcome: "",
  status: "active",
  dial: "normal",
  source: "chat",
  progress: 40,
  projectIds: [],
  createdAt: T,
  updatedAt: T,
};
const done: ProactiveAction = {
  id: "a1",
  goalId: "g1",
  kind: "research",
  title: "Found the 5 best-selling mugs",
  instructions: "",
  trigger: "schedule",
  status: "done",
  minutes: 15,
  runId: "r1",
  result: "Saved to the shop project",
  createdAt: T,
  updatedAt: T,
};
const waiting: ProactiveAction = {
  ...done,
  id: "a2",
  title: "Pay $20 to boost the top listing",
  status: "needs_approval",
  risk: "money",
  result: undefined,
};
const digest: ProactiveDigest = {
  day: "2026-11-19",
  headline: "Did 1 thing for you today",
  items: [done],
  waiting: [waiting],
};
const metrics: ProactiveMetrics = {
  actions: 2,
  decided: 0,
  acceptanceRate: null,
  undoRate: null,
  goals: [],
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  api.goals.list.mockResolvedValue([goal]);
  api.proactive.today.mockResolvedValue(digest);
  api.proactive.metrics.mockResolvedValue(metrics);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GoalsOverlay onClose={() => undefined} />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Grow my Etsy sales"));
}

async function click(label: string) {
  const target = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.includes(label) || b.getAttribute("aria-label")?.startsWith(label),
  );
  if (!target) throw new Error(`no button ${label}: ${host.textContent}`);
  await act(async () => target.click());
}

it("shows today's digest, what waits for an OK, and the goals with their dial", async () => {
  await show();
  expect(host.textContent).toContain("Did 1 thing for you today");
  expect(host.textContent).toContain("Saved to the shop project");
  expect(host.textContent).toContain("It would spend money");
  const dial = host.querySelector("select") as HTMLSelectElement;
  expect(dial.value).toBe("normal");
  expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("40");
});

it("keeps, approves, undoes and turns the dial", async () => {
  api.proactive.decide.mockResolvedValue({ ...done, verdict: "accepted" });
  api.proactive.approve.mockResolvedValue({ ...waiting, status: "queued" });
  api.proactive.undo.mockResolvedValue({
    action: { ...done, verdict: "undone" },
    reverted: 1,
    note: "Put back the way it was.",
  });
  api.goals.update.mockResolvedValue({ ...goal, dial: "go_hard" });
  await show();
  await click("Keep");
  expect(api.proactive.decide).toHaveBeenCalledWith({ actionId: "a1", verdict: "accepted" });
  await click("Go ahead");
  expect(api.proactive.approve).toHaveBeenCalledWith({ actionId: "a2", approve: true });
  await click("Undo Found");
  await vi.waitFor(() => expect(host.textContent).toContain("Put back the way it was."));
  const dial = host.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    dial.value = "go_hard";
    dial.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(api.goals.update).toHaveBeenCalledWith({ id: "g1", dial: "go_hard" });
});

it("never shows a raw error", async () => {
  api.proactive.undo.mockRejectedValue(new Error("PrismaClientKnownRequestError P2025"));
  await show();
  await click("Undo Found");
  await vi.waitFor(() => expect(host.textContent).toContain("That didn't go through. Try again."));
  expect(host.textContent).not.toContain("Prisma");
});

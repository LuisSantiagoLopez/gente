// @vitest-environment jsdom
import type { LearnedChange } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LearnedOverlay } from "./LearnedOverlay";

const api = vi.hoisted(() => ({
  learning: { list: vi.fn(), confirm: vi.fn(), dismiss: vi.fn(), undo: vi.fn() },
  agentSkills: { list: vi.fn() },
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
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
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
    Spinner: () => createElement("span", null, "…"),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => createElement("button", { type: "button", onClick, disabled }, children),
  };
});

const change = (overrides: Partial<LearnedChange>): LearnedChange => ({
  id: "c1",
  skillId: "skill1",
  skillName: "weekly-report",
  version: 1,
  reason: "Use a warmer tone.",
  source: "user_feedback",
  status: "live",
  diff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1,1 +1,2 @@\n Three bullets.\n+Warm tone.\n",
  createdAt: "2026-11-19T10:00:00.000Z",
  canUndo: true,
  ...overrides,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(api.learning)) fn.mockReset();
  api.agentSkills.list.mockReset().mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <LearnedOverlay onClose={() => {}} />
      </QueryClientProvider>,
    ),
  );
}

const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);

it("lists learnings in plain words and undoes one in a click", async () => {
  api.learning.list.mockResolvedValue([
    change({}),
    change({
      id: "w1",
      reason: "Lead with the biggest win.",
      source: "web_content",
      status: "quarantined",
      canUndo: false,
      heldBecause: "Learned while outside content was in play. Confirm it to use it.",
    }),
  ]);
  api.learning.undo.mockResolvedValue(change({ status: "undone", canUndo: false }));
  await open();
  await vi.waitFor(() => expect(host.textContent).toContain("Use a warmer tone."));
  expect(host.textContent).toContain("Waiting for you");
  expect(host.textContent).toContain("From outside content");
  expect(host.textContent).toContain("From what you said");

  await act(async () => button("See the change")?.click());
  expect(host.querySelector("pre")?.textContent).toContain("+Warm tone.");

  await act(async () => button("Undo")?.click());
  await vi.waitFor(() =>
    expect(api.learning.undo).toHaveBeenCalledWith({ skillId: "skill1", changeId: "c1" }),
  );
  await vi.waitFor(() => expect(api.learning.list).toHaveBeenCalledTimes(2));
});

it("confirms or dismisses a web lesson", async () => {
  api.learning.list.mockResolvedValue([
    change({ id: "w1", source: "web_content", status: "quarantined", canUndo: false }),
  ]);
  api.learning.confirm.mockResolvedValue(change({ id: "w1" }));
  await open();
  await vi.waitFor(() => expect(button("Use it")).toBeDefined());
  expect(button("Undo")).toBeUndefined();
  await act(async () => button("Use it")?.click());
  await vi.waitFor(() =>
    expect(api.learning.confirm).toHaveBeenCalledWith({ skillId: "skill1", changeId: "w1" }),
  );
});

it("shows a calm sentence instead of a raw error", async () => {
  api.learning.list.mockResolvedValue([change({})]);
  api.learning.undo.mockRejectedValue(new Error("ECONNRESET at socket.ts:42"));
  await open();
  await vi.waitFor(() => expect(button("Undo")).toBeDefined());
  await act(async () => button("Undo")?.click());
  await vi.waitFor(() => expect(host.textContent).toContain("Couldn't undo that. Try again."));
  expect(host.textContent).not.toContain("ECONNRESET");
});

it("keeps settled learnings behind a click", async () => {
  api.learning.list.mockResolvedValue([
    change({ id: "r1", status: "rejected", canUndo: false, heldBecause: "Kept out." }),
  ]);
  await open();
  await vi.waitFor(() => expect(button("Not in use (1)")).toBeDefined());
  expect(host.textContent).not.toContain("Use a warmer tone.");
  await act(async () => button("Not in use (1)")?.click());
  expect(host.textContent).toContain("Kept out.");
});

it("says what will show up when nothing is learned yet", async () => {
  api.learning.list.mockResolvedValue([]);
  await open();
  await vi.waitFor(() => expect(host.textContent).toContain("Nothing yet."));
});

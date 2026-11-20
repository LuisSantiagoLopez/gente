// @vitest-environment jsdom
// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { BrainEntry, Project } from "@rakazo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrainsOverlay } from "./BrainsOverlay";
import { ProjectsOverlay } from "./ProjectsOverlay";

const api = vi.hoisted(() => ({
  brains: { list: vi.fn(), update: vi.fn(), remove: vi.fn() },
  projects: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    feedback: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../../lib/query/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => ({
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
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
  const field =
    (tag: "input" | "textarea") =>
    (props: {
      value?: string;
      onChange?: () => void;
      "aria-label"?: string;
      placeholder?: string;
    }) =>
      createElement(tag, {
        value: props.value,
        onChange: props.onChange,
        placeholder: props.placeholder,
        "aria-label": props["aria-label"],
      });
  return {
    Dialog: container,
    DialogClose: container,
    DialogContent: container,
    DialogHeader: container,
    DialogTitle: container,
    Skeleton: () => createElement("div", { "data-skeleton": true }),
    Input: field("input"),
    Textarea: field("textarea"),
    Button: (props: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      type?: "button" | "submit";
      "aria-label"?: string;
      "aria-expanded"?: boolean;
    }) =>
      createElement(
        "button",
        {
          type: props.type ?? "button",
          onClick: props.onClick,
          disabled: props.disabled,
          "aria-label": props["aria-label"],
          "aria-expanded": props["aria-expanded"],
        },
        props.children,
      ),
  };
});

const T = "2026-11-19T10:00:00.000Z";
const brain: BrainEntry = {
  id: "doc1",
  slug: "running-shoes",
  topic: "Running shoes",
  keywords: ["marathon"],
  revision: 2,
  updatedAt: T,
  content:
    "---\ntopic: Running shoes\n---\n# Running shoes\n\n- Pegasus weighs 280 g [1] · 2026-11-19\n\n## Sources\n[1] url https://www.example.com/p41\n",
  facts: [
    {
      text: "Pegasus weighs 280 g",
      addedAt: T,
      citations: [
        { kind: "url", ref: "https://www.example.com/p41" },
        { kind: "user", ref: "you" },
      ],
    },
  ],
};
const project: Project = {
  id: "p1",
  name: "Launch site",
  status: "active",
  goals: ["Ship v1"],
  tasks: [
    { id: "t1", title: "Write copy", status: "doing", updatedAt: T },
    { id: "t2", title: "Pick colors", status: "done", updatedAt: T },
  ],
  assets: [],
  timeline: [{ at: T, kind: "status", by: "bot", text: "Write copy: doing" }],
  brainSlugs: ["running-shoes"],
  skillNames: [],
  threadIds: ["th1"],
  createdAt: T,
  updatedAt: T,
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  );
}

function button(label: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.includes(label) || b.getAttribute("aria-label")?.startsWith(label),
  );
}

async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`no button ${label}: ${host.textContent}`);
  await act(async () => target.click());
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("lists brains, opens one to its cited facts, and deletes only after a second click", async () => {
  api.brains.list.mockResolvedValue([brain]);
  api.brains.remove.mockResolvedValue({ ok: true });
  await show(<BrainsOverlay onClose={() => {}} />);
  await vi.waitFor(() => expect(host.textContent).toContain("1 note"));
  await click("Running shoes");
  expect(host.textContent).toContain("Pegasus weighs 280 g");
  expect(host.querySelector('a[href="https://www.example.com/p41"]')?.textContent).toBe(
    "example.com",
  );
  expect(host.textContent).toContain("you");
  await click("Delete");
  expect(api.brains.remove).not.toHaveBeenCalled();
  api.brains.list.mockResolvedValue([]);
  await click("Delete for good");
  await vi.waitFor(() => expect(api.brains.remove).toHaveBeenCalledWith({ id: "doc1" }));
  await vi.waitFor(() => expect(host.textContent).toContain("Nothing here yet"));
});

it("saves an edited brain file with its revision and never shows a raw error", async () => {
  api.brains.list.mockResolvedValue([brain]);
  api.brains.update.mockRejectedValue(new Error("PrismaClientKnownRequestError: P2034 deadlock"));
  await show(<BrainsOverlay onClose={() => {}} initialSlug="running-shoes" />);
  await vi.waitFor(() => expect(button("Edit")).toBeDefined());
  await click("Edit");
  const field = host.querySelector("textarea")!;
  await type(field, `${brain.content}- More`);
  await click("Save");
  await vi.waitFor(() =>
    expect(api.brains.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc1", expectedRevision: 2 }),
    ),
  );
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Couldn't save. Open it again and retry."),
  );
  expect(host.textContent).not.toContain("Prisma");
});

it("shows a calm message and a retry when brains cannot load", async () => {
  api.brains.list.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));
  await show(<BrainsOverlay onClose={() => {}} />);
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Couldn't load your brains. Try again."),
  );
  expect(host.textContent).not.toContain("ECONNREFUSED");
  expect(button("Retry")).toBeDefined();
});

it("opens a project on its tasks and feedback, folding the timeline and links away", async () => {
  api.projects.list.mockResolvedValue([project]);
  api.projects.update.mockResolvedValue(project);
  api.projects.feedback.mockResolvedValue(project);
  const onOpenBrain = vi.fn();
  await show(<ProjectsOverlay onClose={() => {}} onOpenBrain={onOpenBrain} />);
  await vi.waitFor(() => expect(host.textContent).toContain("1 of 2 done"));
  await click("Launch site");
  expect(host.textContent).toContain("Ship v1");
  expect(host.querySelector('[data-testid="project-timeline"]')).toBeNull();

  await click("Write copy");
  await vi.waitFor(() =>
    expect(api.projects.update).toHaveBeenCalledWith({
      id: "p1",
      task: { id: "t1", status: "done" },
    }),
  );

  await type(host.querySelector('textarea[aria-label="Feedback"]')!, "Shorter headline");
  await click("Send feedback");
  await vi.waitFor(() =>
    expect(api.projects.feedback).toHaveBeenCalledWith({ id: "p1", text: "Shorter headline" }),
  );

  await click("Timeline");
  expect(host.querySelector('[data-testid="project-timeline"]')?.textContent).toContain(
    "Gente: Write copy: doing",
  );
  await click("Brains and skills");
  await click("running shoes");
  expect(onOpenBrain).toHaveBeenCalledWith("running-shoes");
});

it("starts a project by name and opens it", async () => {
  api.projects.list.mockResolvedValue([]);
  api.projects.create.mockImplementation(async ({ name }: { name: string }) => {
    const created = { ...project, id: "p2", name, tasks: [], timeline: [], brainSlugs: [] };
    api.projects.list.mockResolvedValue([created]);
    return created;
  });
  await show(<ProjectsOverlay onClose={() => {}} />);
  await vi.waitFor(() => expect(host.textContent).toContain("No projects yet"));
  await click("New project");
  await type(host.querySelector('input[aria-label="Project name"]')!, "Garden");
  await click("Start");
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid="project-detail"]')?.textContent).toContain("Garden"),
  );
});

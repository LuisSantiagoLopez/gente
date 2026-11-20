// @vitest-environment jsdom
import { Toaster } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  recordMessageSent,
  resetStarPromptSessionForTests,
  STAR_PROMPT_DISMISSED_KEY,
  STAR_PROMPT_SENT_KEY,
} from "./github-star-prompt";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  localStorage.clear();
  resetStarPromptSessionForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Toaster />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const prompt = () => document.querySelector('[aria-label="Star on GitHub"]');

async function send(times: number) {
  for (let i = 0; i < times; i++) await act(async () => recordMessageSent());
}

// Gente (QA-024): people using Gente are never asked for a GitHub star.
it("never asks for a GitHub star", async () => {
  await send(10);
  expect(prompt()).toBeNull();
});

it("asks at most once per session", async () => {
  await send(6);
  const count = localStorage.getItem(STAR_PROMPT_SENT_KEY);
  await send(2);
  expect(localStorage.getItem(STAR_PROMPT_SENT_KEY)).toBe(count);
});

// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
import { Trans } from "@lingui/react/macro";
import { BookOpen, FolderKanban, Sparkles, Target } from "lucide-react";
import type { ShellOverlay } from "../shell-overlay-url";

type LearnOverlay = Extract<
  NonNullable<ShellOverlay>,
  { kind: "goals" | "projects" | "brains" | "learned" }
>;

/**
 * Goals, projects, brains and what Gente learned, one click from the only input box. Quiet until hovered,
 * so the composer stays the one thing on screen.
 */
export function LearnShortcuts({ onOpen }: { onOpen: (overlay: LearnOverlay) => void }) {
  const chip =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-body-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <nav
      aria-label="Gente"
      data-gente-rise
      className="pointer-events-auto mx-auto flex w-fit items-center gap-1 pb-1"
    >
      <button type="button" className={chip} onClick={() => onOpen({ kind: "goals" })}>
        <Target className="size-3.5" aria-hidden />
        <Trans>Goals</Trans>
      </button>
      <button type="button" className={chip} onClick={() => onOpen({ kind: "projects" })}>
        <FolderKanban className="size-3.5" aria-hidden />
        <Trans>Projects</Trans>
      </button>
      <button type="button" className={chip} onClick={() => onOpen({ kind: "brains" })}>
        <BookOpen className="size-3.5" aria-hidden />
        <Trans>Brains</Trans>
      </button>
      <button type="button" className={chip} onClick={() => onOpen({ kind: "learned" })}>
        <Sparkles className="size-3.5" aria-hidden />
        <Trans>Skills</Trans>
      </button>
    </nav>
  );
}

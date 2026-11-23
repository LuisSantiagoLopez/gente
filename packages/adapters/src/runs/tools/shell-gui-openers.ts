// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// A shell command that opens a window (xdg-open, a browser) never returns while the window is
// open, so the step hung for minutes until the command timeout (seen in the software use-case
// chat: "Running: xdg-open expense-tracker/index.html… 2m 06s"). A single such command is started
// in the background instead, and the model is told how to look at it.
// Who calls it: run-tools-computer.ts (shell), before the command is sent to the computer.

const OPENERS =
  /^(?:xdg-open|gio\s+open|sensible-browser|x-www-browser|google-chrome(?:-stable)?|chromium(?:-browser)?|firefox)\b/;

export const OPENED_NOTE =
  "Opened in the background (a window command does not return). Use computer_observe to look at it, or browser_navigate for a web page.";

/** The command to run instead, or null to run it as written. */
export function detachedGuiOpener(command: string): string | null {
  const trimmed = command.trim();
  // Only one plain command, optionally after `cd <dir> &&`: no pipes, lists or background marks.
  const match = /^(cd\s+[^;&|]+?\s*&&\s*)?([^;&|]+)$/.exec(trimmed);
  if (!match) return null;
  const [, cd = "", opener = ""] = match;
  if (!OPENERS.test(opener.trim())) return null;
  return `${cd}nohup ${opener.trim()} >/dev/null 2>&1 &\nsleep 2; echo '${OPENED_NOTE}'`;
}

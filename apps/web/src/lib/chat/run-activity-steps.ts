// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Works out what a reply's activity row says from the run's activity: how long it thought or
// worked, how many tool steps it took, the newest thought, and the timeline of real thoughts
// and tool steps (no filler rows). Used by RunActivityRow.tsx and RunActivityTimeline.tsx.
import type { RunActivity, RunActivityStep } from "@rakazo/contracts";

function at(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** How long the run read and thought before its first words: until now while it still thinks. */
export function thoughtMs(activity: RunActivity | undefined, now: number): number | undefined {
  const start = at(activity?.startedAt);
  if (start === undefined) return undefined;
  const end = at(activity?.firstOutputAt) ?? at(activity?.endedAt) ?? now;
  return Math.max(0, end - start);
}

/** Whether a step is a question card, whose wait for the person is not work. */
const isQuestion = (step: RunActivityStep) =>
  step.kind !== "thought" && /^Ask(ing|ed) you\b/.test(step.label);

/**
 * How long the run worked: start to end, less the time it waited for the person to answer a
 * question card (from the card until the next thing the run did).
 */
export function workedMs(activity: RunActivity | undefined, now: number): number | undefined {
  const start = at(activity?.startedAt);
  if (!activity || start === undefined) return undefined;
  const end = at(activity.endedAt) ?? now;
  let waited = 0;
  activity.steps.forEach((step, index) => {
    if (!isQuestion(step)) return;
    const asked = at(step.startedAt);
    const next = at(activity.steps[index + 1]?.startedAt) ?? end;
    if (asked !== undefined) waited += Math.max(0, next - asked);
  });
  return Math.max(0, end - start - waited);
}

/** The tool calls a run made, leaving out its stretches of thinking. */
export function toolStepCount(activity: RunActivity | undefined): number {
  return activity?.steps.filter((step) => step.kind !== "thought").length ?? 0;
}

/** Real thoughts and real tool steps, in order. */
export function activityTimeline(activity: RunActivity | undefined): RunActivityStep[] {
  return activity?.steps ?? [];
}

/** The label of a tool step still running, for the working line. */
export function runningStepLabel(activity: RunActivity | undefined): string | undefined {
  return activity?.steps.findLast((step) => step.kind !== "thought" && step.status === "running")
    ?.label;
}

/** The newest thought on one line: the one streaming now, else the last one saved. */
export function latestThought(activity: RunActivity | undefined, live: string): string {
  const text = live || activity?.steps.findLast((step) => step.kind === "thought")?.output || "";
  const lines = text.trim().split("\n").filter(Boolean);
  return (lines.at(-1) ?? "").trim();
}

/**
 * Thinking still streaming that is not yet saved as a step. The live text keeps everything
 * since the model's turn began, so the part already saved is cut off.
 */
export function unsavedThinking(activity: RunActivity | undefined, live: string | undefined) {
  const text = live?.trim() ?? "";
  if (!text) return "";
  const saved = activity?.steps
    .findLast((step) => step.kind === "thought")
    ?.output?.replace(/…$/, "")
    .trim();
  if (!saved) return text;
  const end = text.lastIndexOf(saved);
  return end < 0 ? text : text.slice(end + saved.length).trim();
}

const PAST: Array<[RegExp, string]> = [
  [/^Asking you\b/, "Asked you"],
  [/^Writing\b/, "Wrote"],
  [/^Reading\b/, "Read"],
  [/^Searching\b/, "Searched"],
  [/^Running\b/, "Ran"],
  [/^Opening\b/, "Opened"],
  [/^Looking at\b/, "Looked at"],
  [/^Listing\b/, "Listed"],
  [/^Saving\b/, "Saved"],
  [/^Using\b/, "Used"],
  [/^Creating\b/, "Created"],
  [/^Connecting\b/, "Connected"],
  [/^Attaching\b/, "Attached"],
  [/^Rendering\b/, "Rendered"],
  [/^Delegating\b/, "Delegated"],
  [/^Checking\b/, "Checked"],
  [/^Finding\b/, "Found"],
  [/^Updating\b/, "Updated"],
  [/^Deleting\b/, "Deleted"],
  [/^Scheduling\b/, "Scheduled"],
  [/^Operating\b/, "Operated"],
  [/^Organizing\b/, "Organized"],
  [/^Rewriting\b/, "Rewrote"],
  [/^Setting\b/, "Set"],
];

/** A finished step in plain past words: "Writing index.html" becomes "Wrote index.html". */
export function pastTenseLabel(label: string): string {
  for (const [pattern, past] of PAST) if (pattern.test(label)) return label.replace(pattern, past);
  return label;
}

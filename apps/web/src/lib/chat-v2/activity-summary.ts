// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// What the one arrow beside the AI's answer says, worked out from its view model: "Thinking…"
// with the newest thought while it works, "Writing index.html…" with a timer while a file is
// written, and "Thought for 4s" or "Worked for 52s · 3 steps" once done. Also the plain verb
// for each finished step. Pure; used by components/chat/ActivityLine.tsx and ActivityStep.tsx.
import { toolDraftPreview } from "../chat/tool-draft";
import type { AssistantView, ToolStep } from "./chat-types";

export type ActivitySummary =
  | { kind: "hidden" }
  /** `since`: when the shown activity started, for a live timer. */
  | { kind: "working"; label: string; preview: string; since?: number }
  | { kind: "waiting" }
  | { kind: "done"; ms: number; tools: number; thoughts: number; failed: boolean };

/** Quiet time after streamed text or thinking that means a tool call is being written. */
export const SILENT_WRITE_MS = 2_000;

export function toolStepCount(view: AssistantView): number {
  return view.steps.filter((step) => step.kind === "tool").length;
}

export function thoughtCount(view: AssistantView): number {
  return view.steps.filter((step) => step.kind === "thought").length + (view.liveThought ? 1 : 0);
}

/** The newest line of the newest thought, for the faded preview. */
export function newestThoughtLine(view: AssistantView): string {
  const last = view.steps.findLast((step) => step.kind === "thought");
  const text = view.liveThought || (last?.kind === "thought" ? last.text : "");
  const lines = text
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  return (lines.at(-1) ?? "").trim();
}

/** The file a tool call names, from its arguments or its label. */
export function draftTitle(name: string, args: string): string {
  const { path } = toolDraftPreview(args);
  const file = path?.split("/").filter(Boolean).at(-1);
  if (file) return `Writing ${file}`;
  if (/write|file|create/i.test(name)) return "Writing a file";
  return "Preparing a step";
}

function runningTool(view: AssistantView): ToolStep | undefined {
  const step = view.steps.findLast((s) => s.kind === "tool" && s.status === "running");
  return step?.kind === "tool" ? step : undefined;
}

export function activitySummary(view: AssistantView | undefined, now: number): ActivitySummary {
  if (!view?.runId) return { kind: "hidden" };
  if (view.status === "working") {
    if (view.toolDraft) {
      return {
        kind: "working",
        label: `${draftTitle(view.toolDraft.name, view.toolDraft.args)}…`,
        preview: "",
        since: view.toolDraft.startedAt,
      };
    }
    const tool = runningTool(view);
    if (tool)
      return { kind: "working", label: `${tool.label}…`, preview: "", since: tool.startedAt };
    // Streaming stopped but the model is still busy: it is writing a tool call (a file).
    if (view.lastStreamAt !== undefined && now - view.lastStreamAt >= SILENT_WRITE_MS)
      return { kind: "working", label: "Writing…", preview: "", since: view.lastStreamAt };
    // The reply is being written: thinking is over, so the line says how long it took.
    if (view.parts.some((part) => part.streaming && part.text)) return finished(view, now);
    return { kind: "working", label: "Thinking…", preview: newestThoughtLine(view) };
  }
  if (view.status === "waiting") return { kind: "waiting" };
  return finished(view, now);
}

function finished(view: AssistantView, now: number): ActivitySummary {
  const tools = toolStepCount(view);
  const thoughts = thoughtCount(view);
  // Nothing to open: no line at all, rather than a filler "Done".
  if (tools === 0 && thoughts === 0) return { kind: "hidden" };
  const start = view.startedAt ?? view.firstThoughtAt;
  const end = tools > 0 ? (view.endedAt ?? now) : (view.firstTokenAt ?? view.endedAt ?? now);
  const ms = start === undefined ? 0 : Math.max(0, end - start);
  return { kind: "done", ms, tools, thoughts, failed: view.status === "failed" };
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
  [/^Checking\b/, "Checked"],
  [/^Finding\b/, "Found"],
  [/^Updating\b/, "Updated"],
  [/^Deleting\b/, "Deleted"],
  [/^Fetching\b/, "Fetched"],
  [/^Editing\b/, "Edited"],
  [/^Publishing\b/, "Published"],
];

/** A step in plain words: "Writing index.html" while it runs, "Wrote index.html" once done. */
export function stepVerb(step: ToolStep): string {
  const label = step.label.replace(/…$/, "").trim();
  if (step.status === "running") return label;
  for (const [pattern, past] of PAST) if (pattern.test(label)) return label.replace(pattern, past);
  return label;
}

export type StepIcon = "file" | "read" | "search" | "web" | "terminal" | "ask" | "folder" | "tool";

/** Which tiny icon a step gets, from its tool name or its words. */
export function stepIcon(step: ToolStep): StepIcon {
  const text = `${step.name} ${step.label}`.toLowerCase();
  if (/ask/.test(text)) return "ask";
  if (/search/.test(text)) return "search";
  if (/fetch|browse|web|open(ing|ed)? http|page/.test(text)) return "web";
  if (/writ|edit|creat|sav/.test(text)) return "file";
  if (/read|look/.test(text)) return "read";
  if (/list|folder/.test(text)) return "folder";
  if (/shell|run|command|terminal/.test(text)) return "terminal";
  return "tool";
}

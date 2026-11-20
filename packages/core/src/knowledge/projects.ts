// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type {
  Project,
  ProjectAsset,
  ProjectStatus,
  ProjectTaskStatus,
  ProjectTimelineEntry,
} from "@rakazo/contracts";
import { ProjectSchema } from "@rakazo/contracts";
import { ClientError } from "../primitives/client-error.js";

export const PROJECT_PATH_PREFIX = "projects/";
/** The newest entries are kept; older ones stay in the document's revisions. */
export const MAX_PROJECT_TIMELINE = 300;
export const MAX_PROJECT_TASKS = 200;

export function projectPath(id: string): string {
  return `${PROJECT_PATH_PREFIX}${id}.json`;
}

export function newProject(input: {
  id: string;
  name: string;
  goals?: string[];
  threadId?: string;
  now: string;
}): Project {
  return {
    id: input.id,
    name: input.name.trim().slice(0, 120),
    status: "active",
    goals: (input.goals ?? [])
      .map((goal) => goal.trim())
      .filter(Boolean)
      .slice(0, 20),
    tasks: [],
    assets: [],
    timeline: [],
    brainSlugs: [],
    skillNames: [],
    threadIds: input.threadId ? [input.threadId] : [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** A stored project, or null when the document no longer has the project's shape. */
export function parseProject(content: string): Project | null {
  try {
    const parsed = ProjectSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export interface ProjectChange {
  name?: string;
  status?: ProjectStatus;
  goals?: string[];
  addTask?: string;
  task?: { id: string; status: ProjectTaskStatus };
  addAsset?: ProjectAsset;
  linkThreadId?: string;
  linkBrain?: string;
  linkSkill?: string;
  note?: string;
  feedback?: string;
  runId?: string;
}

export class ProjectChangeError extends ClientError {
  constructor(message: string) {
    super("BAD_REQUEST", message, "project_change");
    this.name = "ProjectChangeError";
  }
}

function nextTaskId(project: Project): string {
  const highest = project.tasks.reduce((max, task) => {
    const n = /^t(\d+)$/.exec(task.id)?.[1];
    return n ? Math.max(max, Number(n)) : max;
  }, 0);
  return `t${highest + 1}`;
}

function oneLine(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Applies one change from the person (`user`) or a bot. Status changes and new tasks are written
 * to the timeline, so the project shows who moved what and when. Throws ProjectChangeError for a
 * task id the project does not have.
 */
export function applyProjectChange(
  project: Project,
  change: ProjectChange,
  by: "user" | "bot",
  now: string,
): Project {
  const next: Project = {
    ...project,
    goals: [...project.goals],
    tasks: project.tasks.map((task) => ({ ...task })),
    assets: [...project.assets],
    timeline: [...project.timeline],
    brainSlugs: [...project.brainSlugs],
    skillNames: [...project.skillNames],
    threadIds: [...project.threadIds],
    updatedAt: now,
  };
  const log = (kind: ProjectTimelineEntry["kind"], text: string) => {
    const clean = oneLine(text, 1000);
    if (!clean) return;
    next.timeline.push({
      at: now,
      kind,
      by,
      text: clean,
      ...(change.runId ? { runId: change.runId } : {}),
    });
  };
  if (change.name?.trim()) next.name = oneLine(change.name, 120);
  if (change.goals)
    next.goals = change.goals
      .map((goal) => oneLine(goal, 300))
      .filter(Boolean)
      .slice(0, 20);
  if (change.status && change.status !== next.status) {
    next.status = change.status;
    log("status", `Project is now ${change.status}.`);
  }
  if (change.addTask?.trim()) {
    if (next.tasks.length >= MAX_PROJECT_TASKS)
      throw new ProjectChangeError("This project has too many tasks.");
    const title = oneLine(change.addTask, 200);
    next.tasks.push({ id: nextTaskId(next), title, status: "todo", updatedAt: now });
    log("status", `Added task: ${title}`);
  }
  if (change.task) {
    const task = next.tasks.find((candidate) => candidate.id === change.task!.id);
    if (!task) throw new ProjectChangeError(`No task ${change.task.id} in this project.`);
    if (task.status !== change.task.status) {
      task.status = change.task.status;
      task.updatedAt = now;
      log("status", `${task.title}: ${change.task.status}`);
    }
  }
  if (change.addAsset && !next.assets.some((asset) => sameAsset(asset, change.addAsset!))) {
    next.assets.push(change.addAsset);
  }
  if (change.linkThreadId && !next.threadIds.includes(change.linkThreadId)) {
    next.threadIds = [...next.threadIds, change.linkThreadId].slice(-50);
  }
  if (change.linkBrain && !next.brainSlugs.includes(change.linkBrain)) {
    next.brainSlugs = [...next.brainSlugs, change.linkBrain].slice(-40);
  }
  if (change.linkSkill && !next.skillNames.includes(change.linkSkill)) {
    next.skillNames = [...next.skillNames, change.linkSkill].slice(-40);
  }
  if (change.note) log("note", change.note);
  if (change.feedback) log("feedback", change.feedback);
  next.timeline = next.timeline.slice(-MAX_PROJECT_TIMELINE);
  return next;
}

function sameAsset(left: ProjectAsset, right: ProjectAsset): boolean {
  if (left.artifactId || right.artifactId) return left.artifactId === right.artifactId;
  if (left.url || right.url) return left.url === right.url;
  return left.name === right.name;
}

/** One timeline entry per finished run of a linked chat; a replayed completion adds nothing. */
export function recordProjectRun(
  project: Project,
  runId: string,
  summary: string,
  now: string,
): Project {
  if (project.timeline.some((entry) => entry.kind === "run" && entry.runId === runId))
    return project;
  const text = oneLine(summary, 280);
  if (!text) return project;
  return {
    ...project,
    timeline: [
      ...project.timeline,
      { at: now, kind: "run" as const, by: "bot" as const, text, runId },
    ].slice(-MAX_PROJECT_TIMELINE),
    updatedAt: now,
  };
}

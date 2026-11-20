// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type {
  LearnedChange,
  SkillChangeSource,
  SkillLearningLog,
  StoredSkillChange,
} from "@rakazo/contracts";
import { ClientError } from "../primitives/client-error.js";
import { unifiedDiff } from "./skill-diff.js";
import { checkSkillChangeSafety } from "./skill-guard.js";
import type { ReplayReport, SkillExample } from "./skill-replay.js";

/** Kept per skill; the oldest go first. Enough to replay without growing forever. */
export const MAX_SKILL_EXAMPLES = 50;
export const MAX_SKILL_CHANGES = 200;

export function emptySkillLearningLog(skill: { id: string; name: string }): SkillLearningLog {
  return { schema: 1, skillId: skill.id, skillName: skill.name, changes: [], examples: [] };
}

function nextVersion(log: SkillLearningLog): number {
  return log.changes.reduce((max, change) => Math.max(max, change.version), 0) + 1;
}

function trimChanges(changes: StoredSkillChange[]): StoredSkillChange[] {
  if (changes.length <= MAX_SKILL_CHANGES) return changes;
  // Drop the oldest settled entries; anything still waiting on the person stays.
  const removable = changes.length - MAX_SKILL_CHANGES;
  let removed = 0;
  return changes.filter((change) => {
    if (removed >= removable) return true;
    if (change.status === "quarantined" || change.status === "live") return true;
    removed += 1;
    return false;
  });
}

function replace(log: SkillLearningLog, change: StoredSkillChange): SkillLearningLog {
  return { ...log, changes: log.changes.map((c) => (c.id === change.id ? change : c)) };
}

function find(log: SkillLearningLog, changeId: string): StoredSkillChange {
  const change = log.changes.find((c) => c.id === changeId);
  if (!change) throw new ClientError("NOT_FOUND", "That change is gone.");
  return change;
}

/**
 * Records a proposed edit. The safety guard runs first: a change that would widen permissions,
 * spending or approvals is rejected on the spot and never tested or applied.
 */
export function proposeSkillChange(
  log: SkillLearningLog,
  input: {
    id: string;
    current: string;
    after: string;
    reason: string;
    source: SkillChangeSource;
    origin?: string;
    now: Date;
  },
): { log: SkillLearningLog; change: StoredSkillChange } {
  const safety = checkSkillChangeSafety(input.current, input.after);
  const change: StoredSkillChange = {
    id: input.id,
    kind: "learn",
    version: nextVersion(log),
    before: input.current,
    after: input.after,
    diff: unifiedDiff(input.current, input.after),
    reason: input.reason.trim(),
    source: input.source,
    ...(input.origin ? { origin: input.origin } : {}),
    status: safety.ok ? "testing" : "rejected",
    createdAt: input.now.toISOString(),
    ...(safety.ok ? {} : { violations: safety.violations, decidedAt: input.now.toISOString() }),
  };
  return { log: { ...log, changes: trimChanges([...log.changes, change]) }, change };
}

/**
 * Settles a change after its replay. It goes live only when every check passed and it did not
 * come from web content; web content waits in quarantine for the person to confirm it.
 */
export function settleSkillChange(
  log: SkillLearningLog,
  changeId: string,
  report: ReplayReport,
  now: Date,
): { log: SkillLearningLog; change: StoredSkillChange } {
  const existing = find(log, changeId);
  if (existing.status !== "testing") throw new ClientError("CONFLICT", "That change is settled.");
  const status = !report.passed
    ? "rejected"
    : existing.source === "web_content"
      ? "quarantined"
      : "live";
  const change: StoredSkillChange = {
    ...existing,
    status,
    report,
    ...(status === "quarantined" ? {} : { decidedAt: now.toISOString() }),
  };
  return { log: replace(log, change), change };
}

/** The person confirms a quarantined learning: it goes live if the skill hasn't moved on. */
export function confirmSkillChange(
  log: SkillLearningLog,
  changeId: string,
  current: string,
  now: Date,
): { log: SkillLearningLog; change: StoredSkillChange } {
  const existing = find(log, changeId);
  if (existing.status !== "quarantined")
    throw new ClientError("CONFLICT", "Only changes waiting for you can be confirmed.");
  if (existing.before !== current) {
    const change = { ...existing, status: "rejected" as const, decidedAt: now.toISOString() };
    return { log: replace(log, change), change };
  }
  const change = { ...existing, status: "live" as const, decidedAt: now.toISOString() };
  return { log: replace(log, change), change };
}

export function dismissSkillChange(
  log: SkillLearningLog,
  changeId: string,
  now: Date,
): { log: SkillLearningLog; change: StoredSkillChange } {
  const existing = find(log, changeId);
  if (existing.status !== "quarantined")
    throw new ClientError("CONFLICT", "Only changes waiting for you can be dismissed.");
  const change = { ...existing, status: "rejected" as const, decidedAt: now.toISOString() };
  return { log: replace(log, change), change };
}

/**
 * Undoes a live learning. The skill goes back to the version before it; learnings applied on top
 * of it are undone with it, since they were built on the text it added. An "undo" entry records
 * the restore as its own version.
 */
export function undoSkillChange(
  log: SkillLearningLog,
  input: { changeId: string; undoId: string; current: string; now: Date },
): { log: SkillLearningLog; change: StoredSkillChange; restore: string } {
  const target = find(log, input.changeId);
  if (target.kind !== "learn" || target.status !== "live")
    throw new ClientError("CONFLICT", "Only a learning in use can be undone.");
  const decidedAt = input.now.toISOString();
  const changes = log.changes.map((change) =>
    change.id === target.id ||
    (change.kind === "learn" && change.status === "live" && change.version > target.version)
      ? { ...change, status: "undone" as const, decidedAt }
      : change,
  );
  const undo: StoredSkillChange = {
    id: input.undoId,
    kind: "undo",
    version: nextVersion(log),
    before: input.current,
    after: target.before,
    diff: unifiedDiff(input.current, target.before),
    reason: `Undid: ${target.reason}`,
    source: target.source,
    status: "live",
    createdAt: decidedAt,
    decidedAt,
    reverts: target.id,
  };
  const next = { ...log, changes: trimChanges([...changes, undo]) };
  return { log: next, change: find(next, target.id), restore: target.before };
}

export function recordSkillExample(log: SkillLearningLog, example: SkillExample): SkillLearningLog {
  const examples = [...log.examples, example];
  return { ...log, examples: examples.slice(-MAX_SKILL_EXAMPLES) };
}

/** Plain words for why a change is not in use. Never an internal error. */
function heldBecause(change: StoredSkillChange): string | undefined {
  if (change.status === "quarantined") return "Learned while outside content was in play. Confirm it to use it.";
  if (change.status !== "rejected") return undefined;
  if (change.violations?.length)
    return "Kept out: it would have let me do more without asking you.";
  if (change.report && !change.report.passed)
    return "Kept out: it broke something you liked before.";
  return "Dismissed.";
}

/** The page's view of a log: learnings only (undo entries are shown through their target). */
export function learnedChanges(log: SkillLearningLog): LearnedChange[] {
  return log.changes
    .filter((change) => change.kind === "learn")
    .map((change) => {
      const held = heldBecause(change);
      return {
        id: change.id,
        skillId: log.skillId,
        skillName: log.skillName,
        version: change.version,
        reason: change.reason,
        source: change.source,
        ...(change.origin ? { origin: change.origin } : {}),
        status: change.status,
        diff: change.diff,
        createdAt: change.createdAt,
        ...(change.decidedAt ? { decidedAt: change.decidedAt } : {}),
        ...(held ? { heldBecause: held } : {}),
        canUndo: change.status === "live",
      };
    });
}

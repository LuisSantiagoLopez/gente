// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { parseSkillMd } from "../skills/agent-skill.js";
import { checkSkillChangeSafety } from "./skill-guard.js";
import { SKILL_REPLAY_RUBRIC_VERSION } from "./skill-learning.prompt.js";

/** A past case the skill handled, kept so later changes can be checked against it. */
export type SkillExample = {
  id: string;
  /** What the person asked. */
  input: string;
  /** The behavior the person approved, or their correction of what went wrong. */
  approved: string;
  createdAt: string;
};

export type ReplayVerdict = "pass" | "fail";

/**
 * Judges whether the changed skill would still produce the approved behavior for one example.
 * Provider-neutral: the caller wires a model, a scripted fake, or nothing.
 */
export interface SkillReplayJudge {
  judge(input: {
    rubricVersion: string;
    skillBefore: string;
    skillAfter: string;
    example: SkillExample;
    signal?: AbortSignal;
  }): Promise<{ verdict: ReplayVerdict; note?: string }>;
}

export type ReplayCheck = {
  /** "structure", "safety", or an example id. */
  name: string;
  /** "unqualified": the judge errored, which never counts as a pass. */
  result: "pass" | "fail" | "unqualified";
  note?: string;
};

export type ReplayReport = {
  passed: boolean;
  rubricVersion: string;
  /** Whether examples were judged; without a judge only structure and safety run. */
  judged: boolean;
  checks: ReplayCheck[];
  ranAt: string;
};

export const MAX_SKILL_BYTES = 64 * 1024;
/** The newest examples are the ones replayed; older ones rarely add signal. */
export const MAX_REPLAYED_EXAMPLES = 8;

/** Deterministic checks that always run, then each past example through the judge if any. */
export async function replaySkillChange(input: {
  before: string;
  after: string;
  examples: SkillExample[];
  judge?: SkillReplayJudge;
  /** A rename the person asked for directly; learned edits never rename. */
  allowRename?: boolean;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<ReplayReport> {
  const checks: ReplayCheck[] = [];
  const parsedBefore = parseSkillMd(input.before);
  const parsedAfter = parseSkillMd(input.after);
  const structure: ReplayCheck =
    "error" in parsedAfter
      ? { name: "structure", result: "fail", note: "The new version is not a valid skill." }
      : new TextEncoder().encode(input.after).length > MAX_SKILL_BYTES
        ? { name: "structure", result: "fail", note: "The new version is too long." }
        : input.before === input.after
          ? { name: "structure", result: "fail", note: "Nothing changed." }
          : !input.allowRename &&
              !("error" in parsedBefore) &&
              parsedBefore.name.toLowerCase() !== parsedAfter.name.toLowerCase()
            ? { name: "structure", result: "fail", note: "A learned change can't rename a skill." }
            : { name: "structure", result: "pass" };
  checks.push(structure);
  const safety = checkSkillChangeSafety(input.before, input.after);
  checks.push(
    safety.ok
      ? { name: "safety", result: "pass" }
      : {
          name: "safety",
          result: "fail",
          note: `Would widen ${[...new Set(safety.violations.map((v) => v.rule))].join(", ")}.`,
        },
  );
  const deterministicPassed = checks.every((check) => check.result === "pass");
  const examples = [...input.examples]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_REPLAYED_EXAMPLES);
  const judge = input.judge;
  if (deterministicPassed && judge) {
    for (const example of examples) {
      try {
        const verdict = await judge.judge({
          rubricVersion: SKILL_REPLAY_RUBRIC_VERSION,
          skillBefore: input.before,
          skillAfter: input.after,
          example,
          signal: input.signal,
        });
        checks.push({ name: example.id, result: verdict.verdict, note: verdict.note });
      } catch {
        checks.push({ name: example.id, result: "unqualified" });
      }
    }
  }
  return {
    passed: checks.every((check) => check.result === "pass"),
    rubricVersion: SKILL_REPLAY_RUBRIC_VERSION,
    judged: Boolean(judge) && deterministicPassed && examples.length > 0,
    checks,
    ranAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

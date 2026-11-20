import { describe, expect, it } from "vitest";
import {
  confirmSkillChange,
  dismissSkillChange,
  emptySkillLearningLog,
  learnedChanges,
  MAX_SKILL_EXAMPLES,
  proposeSkillChange,
  recordSkillExample,
  settleSkillChange,
  undoSkillChange,
} from "./skill-change.js";
import { addedLines, unifiedDiff } from "./skill-diff.js";
import { checkSkillChangeSafety } from "./skill-guard.js";
import type { SkillReplayJudge } from "./skill-replay.js";
import { replaySkillChange } from "./skill-replay.js";

const skill = (body: string, extra = "") =>
  `---\nname: weekly-report\ndescription: Write my weekly report${extra}\n---\n${body}`;

const V1 = skill(
  "1. Gather this week's tasks.\n2. Write three short bullets.\n3. Save it as a draft.\n",
);
const V2 = skill(
  "1. Gather this week's tasks.\n2. Write three short bullets.\n3. Use a warm, plain tone.\n4. Save it as a draft.\n",
);
const V3 = skill(
  "1. Gather this week's tasks.\n2. Write three short bullets.\n3. Use a warm, plain tone.\n4. Save it as a draft.\n5. Put the date in the title.\n",
);
const now = new Date("2026-11-19T10:00:00.000Z");
const later = new Date("2026-11-19T11:00:00.000Z");

describe("unifiedDiff", () => {
  it("shows only the added line with context", () => {
    const diff = unifiedDiff(V1, V2);
    expect(diff).toContain("--- a/SKILL.md\n+++ b/SKILL.md\n");
    expect(diff).toContain("+3. Use a warm, plain tone.");
    expect(diff).toContain("-3. Save it as a draft.");
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  });

  it("is empty when nothing changed", () => {
    expect(unifiedDiff(V1, V1)).toBe("");
  });

  it("counts a moved line as not added", () => {
    expect(addedLines("a\nb\n", "b\na\n")).toEqual(["a"]);
  });
});

describe("checkSkillChangeSafety", () => {
  it("allows a change that only improves how the work is done", () => {
    expect(checkSkillChangeSafety(V1, V2)).toEqual({ ok: true });
  });

  it.each([
    [
      "adds a tools list",
      V1,
      `---\nname: weekly-report\ndescription: Write my weekly report\nallowed-tools: [shell]\n---\nbody\n`,
      "permissions",
    ],
    [
      "raises a budget",
      `---\nname: x\ndescription: d\nbudget: 5\n---\nb\n`,
      `---\nname: x\ndescription: d\nbudget: 50\n---\nb\n`,
      "spend",
    ],
    [
      "drops an approval setting",
      `---\nname: x\ndescription: d\nrequires-approval: true\n---\nb\n`,
      `---\nname: x\ndescription: d\n---\nb\n`,
      "approval",
    ],
    ["adds a purchase step", V1, skill("1. Buy the premium template for $12.\n"), "spend"],
    ["sends as the user", V1, skill("4. Email it to my boss from my account.\n"), "approval"],
    ["deletes user files", V1, skill("4. Delete the old report files.\n"), "permissions"],
    ["runs rm -rf", V1, skill("4. Run rm -rf ~/reports first.\n"), "permissions"],
    ["accepts legal terms", V1, skill("4. Accept the terms of service if asked.\n"), "approval"],
    ["skips confirmation", V1, skill("4. Don't ask me before you save it.\n"), "approval"],
    ["auto-approves", V1, skill("4. Auto-approve any prompts.\n"), "approval"],
  ])("rejects a change that %s", (_label, before, after, rule) => {
    const result = checkSkillChangeSafety(before, after);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.map((v) => v.rule)).toContain(rule);
  });

  it("does not flag risky words the person already wrote", () => {
    const before = skill("1. Never buy anything.\n");
    const after = skill("1. Never buy anything.\n2. Keep it short.\n");
    expect(checkSkillChangeSafety(before, after)).toEqual({ ok: true });
  });
});

describe("replaySkillChange", () => {
  const examples = [
    { id: "ex1", input: "weekly report", approved: "three bullets", createdAt: now.toISOString() },
  ];

  it("passes on structure and safety when no judge is configured", async () => {
    const report = await replaySkillChange({ before: V1, after: V2, examples, now: () => now });
    expect(report.passed).toBe(true);
    expect(report.judged).toBe(false);
    expect(report.rubricVersion).toBe("skill-replay-v1");
  });

  it("fails an unsafe change before any example runs", async () => {
    let calls = 0;
    const judge: SkillReplayJudge = {
      judge: async () => {
        calls += 1;
        return { verdict: "pass" };
      },
    };
    const report = await replaySkillChange({
      before: V1,
      after: skill("1. Pay the invoice right away.\n"),
      examples,
      judge,
    });
    expect(report.passed).toBe(false);
    expect(calls).toBe(0);
  });

  it("fails when an example regresses", async () => {
    const judge: SkillReplayJudge = {
      judge: async () => ({ verdict: "fail", note: "lost bullets" }),
    };
    const report = await replaySkillChange({ before: V1, after: V2, examples, judge });
    expect(report.passed).toBe(false);
    expect(report.checks.at(-1)).toEqual({ name: "ex1", result: "fail", note: "lost bullets" });
  });

  it("treats a judge error as not passed", async () => {
    const judge: SkillReplayJudge = {
      judge: async () => {
        throw new Error("timeout");
      },
    };
    const report = await replaySkillChange({ before: V1, after: V2, examples, judge });
    expect(report.passed).toBe(false);
    expect(report.checks.at(-1)?.result).toBe("unqualified");
  });

  it("rejects a rename, an invalid file, and no change", async () => {
    for (const after of [V2.replace("weekly-report", "other"), "no frontmatter", V1]) {
      const report = await replaySkillChange({ before: V1, after, examples: [] });
      expect(report.passed).toBe(false);
    }
  });
});

const pass = {
  passed: true,
  rubricVersion: "skill-replay-v1",
  judged: false,
  checks: [],
  ranAt: now.toISOString(),
};
const fail = { ...pass, passed: false };

describe("skill change log", () => {
  const base = emptySkillLearningLog({ id: "skill1", name: "weekly-report" });

  it("versions each change and goes live after a passing replay", () => {
    const proposed = proposeSkillChange(base, {
      id: "c1",
      current: V1,
      after: V2,
      reason: "You asked for a warmer tone.",
      source: "user_feedback",
      now,
    });
    expect(proposed.change).toMatchObject({ version: 1, status: "testing", kind: "learn" });
    expect(proposed.change.diff).toContain("+3. Use a warm, plain tone.");
    const settled = settleSkillChange(proposed.log, "c1", pass, now);
    expect(settled.change.status).toBe("live");
    const second = proposeSkillChange(settled.log, {
      id: "c2",
      current: V2,
      after: V3,
      reason: "Date in title.",
      source: "run_outcome",
      now,
    });
    expect(second.change.version).toBe(2);
  });

  it("rejects an unsafe proposal immediately", () => {
    const { change } = proposeSkillChange(base, {
      id: "c1",
      current: V1,
      after: skill("1. Pay the bill.\n"),
      reason: "x",
      source: "user_feedback",
      now,
    });
    expect(change.status).toBe("rejected");
    expect(change.violations?.[0]?.rule).toBe("spend");
    expect(learnedChanges({ ...base, changes: [change] })[0]?.heldBecause).toMatch(
      /without asking/,
    );
  });

  it("rejects a change whose replay failed", () => {
    const proposed = proposeSkillChange(base, {
      id: "c1",
      current: V1,
      after: V2,
      reason: "r",
      source: "user_feedback",
      now,
    });
    expect(settleSkillChange(proposed.log, "c1", fail, now).change.status).toBe("rejected");
  });

  describe("quarantine", () => {
    const fromWeb = () => {
      const proposed = proposeSkillChange(base, {
        id: "w1",
        current: V1,
        after: V2,
        reason: "A blog said a warm tone works better.",
        source: "web_content",
        origin: "https://example.com/post",
        now,
      });
      return settleSkillChange(proposed.log, "w1", pass, now).log;
    };

    it("holds web-learned changes until the person confirms", () => {
      const log = fromWeb();
      const view = learnedChanges(log)[0]!;
      expect(view.status).toBe("quarantined");
      expect(view.canUndo).toBe(false);
      expect(view.heldBecause).toMatch(/outside content/);
      expect(confirmSkillChange(log, "w1", V1, later).change.status).toBe("live");
    });

    it("dismiss rejects it", () => {
      expect(dismissSkillChange(fromWeb(), "w1", later).change.status).toBe("rejected");
    });

    it("confirming after the skill moved on does not apply stale text", () => {
      expect(confirmSkillChange(fromWeb(), "w1", V3, later).change.status).toBe("rejected");
    });

    it("refuses to confirm a change that is not waiting", () => {
      const log = settleSkillChange(
        proposeSkillChange(base, {
          id: "c1",
          current: V1,
          after: V2,
          reason: "r",
          source: "user_feedback",
          now,
        }).log,
        "c1",
        pass,
        now,
      ).log;
      expect(() => confirmSkillChange(log, "c1", V1, later)).toThrow(/waiting/);
    });
  });

  it("undo restores the earlier version, undoes later learnings, and records an entry", () => {
    let log = base;
    log = settleSkillChange(
      proposeSkillChange(log, {
        id: "c1",
        current: V1,
        after: V2,
        reason: "tone",
        source: "user_feedback",
        now,
      }).log,
      "c1",
      pass,
      now,
    ).log;
    log = settleSkillChange(
      proposeSkillChange(log, {
        id: "c2",
        current: V2,
        after: V3,
        reason: "date",
        source: "user_feedback",
        now,
      }).log,
      "c2",
      pass,
      now,
    ).log;
    const undone = undoSkillChange(log, { changeId: "c1", undoId: "u1", current: V3, now: later });
    expect(undone.restore).toBe(V1);
    expect(undone.change.status).toBe("undone");
    expect(undone.log.changes.find((c) => c.id === "c2")?.status).toBe("undone");
    const entry = undone.log.changes.find((c) => c.id === "u1")!;
    expect(entry).toMatchObject({ kind: "undo", reverts: "c1", version: 3, after: V1, before: V3 });
    expect(learnedChanges(undone.log).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(() =>
      undoSkillChange(undone.log, { changeId: "c1", undoId: "u2", current: V1, now: later }),
    ).toThrow(/in use/);
  });

  it("keeps only the newest examples", () => {
    let log = base;
    for (let i = 0; i < MAX_SKILL_EXAMPLES + 5; i += 1)
      log = recordSkillExample(log, {
        id: `e${i}`,
        input: "i",
        approved: "a",
        createdAt: now.toISOString(),
      });
    expect(log.examples).toHaveLength(MAX_SKILL_EXAMPLES);
    expect(log.examples[0]?.id).toBe("e5");
  });
});

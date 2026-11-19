// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { randomUUID } from "node:crypto";
import {
  listSkillLearningLogs,
  readSkillLearningLog,
  writeSkillLearningLog,
} from "@rakazo/adapters";
import type { Actor, LearnedChange, SkillLearningLog } from "@rakazo/contracts";
import {
  ClientError,
  confirmSkillChange,
  dismissSkillChange,
  learnedChanges,
  proposeSkillChange,
  recordSkillExample,
  replaySkillChange,
  settleSkillChange,
  undoSkillChange,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import type { createAgentSkillsService } from "../bots/agent-skills.js";
import type { SkillLearningModel } from "./skill-learning-model.js";

/** A model judge is slow on a local model, so a replay checks the newest few examples. */
const JUDGED_EXAMPLES = 3;

type AgentSkills = Pick<ReturnType<typeof createAgentSkillsService>, "get" | "update">;

export function createSkillLearningService(deps: {
  prisma: PrismaClient;
  agentSkills: AgentSkills;
  model?: SkillLearningModel;
  now?: () => Date;
  newId?: () => string;
}) {
  const now = () => deps.now?.() ?? new Date();
  const newId = () => deps.newId?.() ?? randomUUID();

  const readLog = (actor: Actor, skill: { id: string; name: string }) =>
    readSkillLearningLog(deps.prisma, actor, skill);
  const writeLog = (
    actor: Actor,
    log: SkillLearningLog,
    read: { revision: number; docId?: string },
  ) => writeSkillLearningLog(deps.prisma, actor, log, read);

  async function writableSkill(actor: Actor, skillId: string) {
    const skill = await deps.agentSkills.get(actor, { skillId });
    if (skill.readOnly)
      throw new ClientError(
        "BAD_REQUEST",
        "Built-in skills don't learn. Make your own copy first.",
      );
    return skill;
  }

  function view(log: SkillLearningLog, changeId: string): LearnedChange {
    const change = learnedChanges(log).find((c) => c.id === changeId);
    if (!change) throw new ClientError("NOT_FOUND", "That change is gone.");
    return change;
  }

  async function apply(actor: Actor, skillId: string, content: string) {
    await deps.agentSkills.update(actor, { skillId, content });
  }

  return {
    async list(actor: Actor): Promise<LearnedChange[]> {
      const logs = await listSkillLearningLogs(deps.prisma, actor);
      return logs
        .flatMap(learnedChanges)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    /**
     * Turns feedback into a proposed edit, replays it against past examples, and applies it if
     * it passed and did not come from web content. Null when nothing applies to this skill.
     */
    async feedback(
      actor: Actor,
      input: {
        skillId: string;
        botId: string;
        request: string;
        reply: string;
        feedback: string;
        origin?: string;
      },
    ): Promise<{ change: LearnedChange | null }> {
      const skill = await writableSkill(actor, input.skillId);
      const read = await readLog(actor, skill);
      const fromWeb = Boolean(input.origin);
      // The person's own words are the example later changes must keep; a web page's are not.
      let log = fromWeb
        ? read.log
        : recordSkillExample(read.log, {
            id: newId(),
            input: input.request,
            approved: input.feedback,
            createdAt: now().toISOString(),
          });
      const proposal = deps.model
        ? await deps.model.propose(actor, input.botId, {
            skill: skill.content,
            request: input.request,
            reply: input.reply,
            feedback: input.feedback,
          })
        : null;
      if (!proposal) {
        if (log !== read.log) await writeLog(actor, log, read);
        return { change: null };
      }
      const proposed = proposeSkillChange(log, {
        id: newId(),
        current: skill.content,
        after: proposal.after,
        reason: proposal.reason,
        source: fromWeb ? "web_content" : "user_feedback",
        ...(input.origin ? { origin: input.origin } : {}),
        now: now(),
      });
      log = proposed.log;
      if (proposed.change.status === "testing") {
        const report = await replaySkillChange({
          before: skill.content,
          after: proposal.after,
          // Examples the person gave before this feedback; the new one is what the edit is for.
          examples: read.log.examples.slice(-JUDGED_EXAMPLES),
          judge: deps.model?.judge?.(actor, input.botId),
          now,
        });
        const settled = settleSkillChange(log, proposed.change.id, report, now());
        log = settled.log;
        if (settled.change.status === "live") await apply(actor, skill.id, settled.change.after);
      }
      await writeLog(actor, log, read);
      return { change: view(log, proposed.change.id) };
    },

    async confirm(actor: Actor, input: { skillId: string; changeId: string }) {
      const skill = await writableSkill(actor, input.skillId);
      const read = await readLog(actor, skill);
      const { log, change } = confirmSkillChange(read.log, input.changeId, skill.content, now());
      if (change.status === "live") await apply(actor, skill.id, change.after);
      await writeLog(actor, log, read);
      return view(log, change.id);
    },

    async dismiss(actor: Actor, input: { skillId: string; changeId: string }) {
      const skill = await writableSkill(actor, input.skillId);
      const read = await readLog(actor, skill);
      const { log, change } = dismissSkillChange(read.log, input.changeId, now());
      await writeLog(actor, log, read);
      return view(log, change.id);
    },

    async undo(actor: Actor, input: { skillId: string; changeId: string }) {
      const skill = await writableSkill(actor, input.skillId);
      const read = await readLog(actor, skill);
      const undone = undoSkillChange(read.log, {
        changeId: input.changeId,
        undoId: newId(),
        current: skill.content,
        now: now(),
      });
      await apply(actor, skill.id, undone.restore);
      await writeLog(actor, undone.log, read);
      return view(undone.log, undone.change.id);
    },
  };
}

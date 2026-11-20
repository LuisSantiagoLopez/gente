// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import {
  createGoalDocument,
  listGoals,
  listProjects,
  loadProactiveState,
  newGoalId,
  proactivePorts,
  removeGoal,
  revertRunChanges,
  updateGoal,
  updateProactiveState,
} from "@rakazo/adapters";
import {
  approveAction,
  buildDigest,
  ClientError,
  decideAction,
  newGoal,
  ProactiveActionNotFoundError,
  proactiveMetrics,
} from "@rakazo/core";
import type { RouterContext } from "./context.js";

/** Goals and Gente's proactive work: the person's own, in the actor's Space, on this computer. */
export function proactiveRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const owner = (actor: { spaceId: string; userId: string }) => ({
    spaceId: actor.spaceId,
    userId: actor.userId,
  });
  const timeZoneOf = async (userId: string) =>
    (await deps.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))
      ?.timezone ?? "UTC";
  const stateOf = async (actor: { spaceId: string; userId: string }) =>
    loadProactiveState(deps.prisma, owner(actor), { timeZone: await timeZoneOf(actor.userId) });
  const projectOwned = async (actor: { spaceId: string; userId: string }, id: string) => {
    if (!(await listProjects(deps.prisma, owner(actor))).some((project) => project.id === id))
      throw new ClientError("NOT_FOUND", "That project is no longer here.", "project_not_found");
  };
  return {
    goals: {
      list: authed.goals.list.handler(({ context }) =>
        listGoals(deps.prisma, owner(context.actor)),
      ),
      create: authed.goals.create.handler(async ({ context, input }) => {
        if (input.projectId) await projectOwned(context.actor, input.projectId);
        return createGoalDocument(
          deps.prisma,
          owner(context.actor),
          newGoal({ id: newGoalId(), source: "user", now: new Date().toISOString(), ...input }),
        );
      }),
      update: authed.goals.update.handler(async ({ context, input }) => {
        const { id, ...change } = input;
        if (change.linkProjectId) await projectOwned(context.actor, change.linkProjectId);
        return updateGoal(deps.prisma, owner(context.actor), id, change);
      }),
      remove: authed.goals.remove.handler(async ({ context, input }) => {
        await removeGoal(deps.prisma, owner(context.actor), input.id);
        return { ok: true as const };
      }),
    },
    proactive: {
      settings: authed.proactive.settings.handler(
        async ({ context }) => (await stateOf(context.actor)).settings,
      ),
      updateSettings: authed.proactive.updateSettings.handler(async ({ context, input }) => {
        const timeZone = await timeZoneOf(context.actor.userId);
        const state = await updateProactiveState(
          deps.prisma,
          owner(context.actor),
          (current) => ({ ...current, settings: { ...current.settings, ...input } }),
          { timeZone },
        );
        return state.settings;
      }),
      today: authed.proactive.today.handler(async ({ context }) =>
        buildDigest(await stateOf(context.actor), new Date()),
      ),
      metrics: authed.proactive.metrics.handler(async ({ context }) => {
        const [state, goals] = await Promise.all([
          stateOf(context.actor),
          listGoals(deps.prisma, owner(context.actor)),
        ]);
        return proactiveMetrics(state, goals);
      }),
      decide: authed.proactive.decide.handler(async ({ context, input }) => {
        const now = new Date().toISOString();
        const state = await updateProactiveState(deps.prisma, owner(context.actor), (current) =>
          decideAction(current, input.actionId, input.verdict, now),
        );
        return state.actions.find((action) => action.id === input.actionId)!;
      }),
      approve: authed.proactive.approve.handler(async ({ context, input }) => {
        const ports = proactivePorts(
          { prisma: deps.prisma, jobs: deps.jobs, events: deps.events },
          owner(context.actor),
          await timeZoneOf(context.actor.userId),
        );
        return approveAction(ports, input.actionId, input.approve);
      }),
      undo: authed.proactive.undo.handler(async ({ context, input }) => {
        const state = await stateOf(context.actor);
        const action = state.actions.find((candidate) => candidate.id === input.actionId);
        if (!action) throw new ProactiveActionNotFoundError();
        const reverted = action.runId
          ? await revertRunChanges(deps.prisma, owner(context.actor), action.runId)
          : 0;
        const now = new Date().toISOString();
        const next = await updateProactiveState(deps.prisma, owner(context.actor), (current) =>
          decideAction(current, action.id, "undone", now),
        );
        return {
          action: next.actions.find((candidate) => candidate.id === action.id)!,
          reverted,
          note:
            reverted > 0
              ? "Put back the way it was."
              : "Nothing here could be put back: it only wrote a reply or a draft. Your AI will do less of this.",
        };
      }),
    },
  };
}

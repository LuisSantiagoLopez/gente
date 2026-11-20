// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  Goal,
  GoalMetrics,
  ProactiveAction,
  ProactiveDial,
  ProactiveRisk,
} from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  OptionSelect,
  Skeleton,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Undo2, X } from "lucide-react";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";

const NO_GOALS: Goal[] = [];

type GoalSave =
  | { kind: "create"; title: string }
  | { kind: "dial"; id: string; dial: ProactiveDial }
  | { kind: "status"; id: string; status: Goal["status"] }
  | { kind: "remove"; id: string }
  | { kind: "decide"; actionId: string; verdict: "accepted" | "rejected" }
  | { kind: "approve"; actionId: string; approve: boolean }
  | { kind: "undo"; actionId: string };

function useDialOptions() {
  const { t } = useLingui();
  return [
    { value: "quiet" as const, label: t`Quiet` },
    { value: "normal" as const, label: t`Normal` },
    { value: "go_hard" as const, label: t`Go hard` },
  ];
}

function useRiskLabel() {
  const { t } = useLingui();
  return (risk: ProactiveRisk) =>
    ({
      money: t`It would spend money`,
      send: t`It would send something as you`,
      delete: t`It would delete your data`,
      legal: t`It would agree to terms`,
    })[risk];
}

function percent(value: number | null): string {
  return value === null ? "" : `${Math.round(value * 100)}%`;
}

/**
 * Goals: what the person is working toward, how hard Gente pushes on each, and today's digest of
 * what it did on its own, each with keep, not this, and undo. Settings and numbers fold away.
 */
export function GoalsOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const dialOptions = useDialOptions();
  const riskLabel = useRiskLabel();
  const queries = useSpaceQueries();
  const goalsList = queries.goals.list.queryOptions();
  const todayRead = queries.proactive.today.queryOptions();
  const metricsRead = queries.proactive.metrics.queryOptions();
  const goalsQuery = useQuery(goalsList);
  const todayQuery = useQuery(todayRead);
  const metricsQuery = useQuery(metricsRead);
  const goals = goalsQuery.data ?? NO_GOALS;
  const today = todayQuery.data;
  const metricsByGoal = new Map<string, GoalMetrics>(
    (metricsQuery.data?.goals ?? []).map((entry) => [entry.goalId, entry]),
  );
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const change = useSave({
    save: async (input: GoalSave, rpc) => {
      switch (input.kind) {
        case "create":
          return rpc.goals.create({ title: input.title });
        case "dial":
          return rpc.goals.update({ id: input.id, dial: input.dial });
        case "status":
          return rpc.goals.update({ id: input.id, status: input.status });
        case "remove":
          await rpc.goals.remove({ id: input.id });
          return null;
        case "decide":
          return rpc.proactive.decide({ actionId: input.actionId, verdict: input.verdict });
        case "approve":
          return rpc.proactive.approve({ actionId: input.actionId, approve: input.approve });
        case "undo":
          return (await rpc.proactive.undo({ actionId: input.actionId })).note;
      }
    },
    stale: [goalsList.queryKey, todayRead.queryKey, metricsRead.queryKey],
    onSaved: (saved, input) => {
      if (input.kind === "create") {
        setAdding(false);
        setTitle("");
      }
      if (input.kind === "remove") setOpenId(null);
      setNote(input.kind === "undo" && typeof saved === "string" ? saved : null);
    },
  });
  const failure = change.error
    ? t`That didn't go through. Try again.`
    : goalsQuery.isError || todayQuery.isError
      ? t`Couldn't load your goals. Try again.`
      : null;
  const busy = change.pending;
  const goalTitle = (id: string) => goals.find((goal) => goal.id === id)?.title ?? "";

  const doneRow = (action: ProactiveAction) => (
    <li key={action.id} className="rounded-xl bg-muted/50 px-4 py-3" data-gente-rise>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-foreground" dir="auto">
            {action.title}
          </p>
          <p className="text-caption text-muted-foreground" dir="auto">
            {goalTitle(action.goalId)}
          </p>
          {action.result ? (
            <p className="text-body-sm text-muted-foreground" dir="auto">
              {action.result}
            </p>
          ) : null}
        </div>
        {action.verdict === "undone" ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            <Trans>Undone</Trans>
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            {action.verdict ? null : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    change.run({ kind: "decide", actionId: action.id, verdict: "accepted" })
                  }
                >
                  <Trans>Keep</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    change.run({ kind: "decide", actionId: action.id, verdict: "rejected" })
                  }
                >
                  <Trans>Not this</Trans>
                </Button>
              </>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t`Undo ${action.title}`}
              disabled={busy}
              onClick={() => change.run({ kind: "undo", actionId: action.id })}
            >
              <Undo2 />
            </Button>
          </div>
        )}
      </div>
    </li>
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        size="2xl"
        className="bg-card"
        data-testid="goals-overlay"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <div>
            <DialogTitle className="text-heading2 text-foreground">
              <Trans>Goals</Trans>
            </DialogTitle>
            <p className="mt-1 max-w-[52ch] text-body-sm text-muted-foreground">
              <Trans>Your AI works toward these on its own and tells you what it did.</Trans>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!adding ? (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setAdding(true)}>
                <Plus />
                <Trans>New goal</Trans>
              </Button>
            ) : null}
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label={t`Close goals`} />}
            >
              <X />
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="rk-scroll flex-1 space-y-6 overflow-y-auto px-8 py-6">
          {failure || note ? (
            <p role="status" className="text-body-sm text-muted-foreground">
              {failure ?? note}
            </p>
          ) : null}
          {adding ? (
            <form
              className="flex gap-2"
              data-gente-rise
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim()) change.run({ kind: "create", title: title.trim() });
              }}
            >
              <Input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label={t`Goal`}
                placeholder={t`What do you want? For example, land a job`}
                maxLength={200}
              />
              <Button type="submit" disabled={busy || !title.trim()}>
                <Trans>Add</Trans>
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </form>
          ) : null}

          {today && (today.items.length > 0 || today.waiting.length > 0) ? (
            <section aria-label={t`Today`} className="space-y-2" data-testid="goals-today">
              <h3 className="text-heading3 text-foreground">{today.headline}</h3>
              {today.waiting.length > 0 ? (
                <ul className="space-y-2">
                  {today.waiting.map((action) => (
                    <li
                      key={action.id}
                      className="rounded-xl border border-border px-4 py-3"
                      data-gente-rise
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body text-foreground" dir="auto">
                            {action.title}
                          </p>
                          <p className="text-caption text-muted-foreground">
                            {action.risk ? riskLabel(action.risk) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              change.run({ kind: "approve", actionId: action.id, approve: true })
                            }
                          >
                            <Trans>Go ahead</Trans>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              change.run({ kind: "approve", actionId: action.id, approve: false })
                            }
                          >
                            <Trans>Skip</Trans>
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-2">{today.items.map(doneRow)}</ul>
            </section>
          ) : null}

          {goalsQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="gente-skeleton h-14 w-full rounded-xl" />
              <Skeleton className="gente-skeleton h-14 w-full rounded-xl" />
            </div>
          ) : goals.length === 0 && !adding ? (
            <p className="py-6 text-center text-body-sm text-muted-foreground">
              <Trans>No goals yet. Tell Your AI what you want, or add one here.</Trans>
            </p>
          ) : (
            <ul className="space-y-2" aria-label={t`Your goals`}>
              {goals.map((goal) => {
                const metrics = metricsByGoal.get(goal.id);
                const open = openId === goal.id;
                return (
                  <li key={goal.id} className="rounded-xl bg-muted/40 px-4 py-3" data-gente-rise>
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-start"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : goal.id)}
                      >
                        {open ? (
                          <ChevronDown className="size-4 shrink-0" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0" />
                        )}
                        <span className="truncate text-body text-foreground" dir="auto">
                          {goal.title}
                        </span>
                        {goal.status !== "active" ? (
                          <span className="shrink-0 text-caption text-muted-foreground">
                            {goal.status === "done" ? t`Done` : t`Paused`}
                          </span>
                        ) : null}
                      </button>
                      <OptionSelect
                        size="sm"
                        className="w-fit"
                        aria-label={t`How proactive for ${goal.title}`}
                        value={goal.dial}
                        options={dialOptions}
                        onValueChange={(dial) => change.run({ kind: "dial", id: goal.id, dial })}
                      />
                    </div>
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={t`Progress`}
                      aria-valuenow={goal.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="gente-progress h-full w-full origin-left rounded-full bg-primary"
                        style={{ transform: `scaleX(${goal.progress / 100})` }}
                      />
                    </div>
                    {open ? (
                      <div className="mt-3 space-y-2" data-gente-rise>
                        {goal.outcome ? (
                          <p className="text-body-sm text-muted-foreground" dir="auto">
                            {goal.outcome}
                          </p>
                        ) : null}
                        {metrics && metrics.actions > 0 ? (
                          <p className="text-caption text-muted-foreground">
                            {metrics.acceptanceRate === null ? (
                              <Trans>{metrics.actions} things done so far.</Trans>
                            ) : (
                              <Trans>
                                {metrics.actions} things done, you kept{" "}
                                {percent(metrics.acceptanceRate)}.
                              </Trans>
                            )}{" "}
                            {metrics.effectiveDial !== goal.dial ? (
                              <Trans>Your AI is easing off this one for now.</Trans>
                            ) : null}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              change.run({
                                kind: "status",
                                id: goal.id,
                                status: goal.status === "active" ? "paused" : "active",
                              })
                            }
                          >
                            {goal.status === "active" ? (
                              <Trans>Pause</Trans>
                            ) : (
                              <Trans>Resume</Trans>
                            )}
                          </Button>
                          {goal.status !== "done" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                change.run({ kind: "status", id: goal.id, status: "done" })
                              }
                            >
                              <Trans>Mark done</Trans>
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => change.run({ kind: "remove", id: goal.id })}
                          >
                            <Trans>Remove</Trans>
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

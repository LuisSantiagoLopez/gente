// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans, useLingui } from "@lingui/react/macro";
import type { LearnedChange } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";

type Action = { kind: "confirm" | "dismiss" | "undo"; change: LearnedChange };

/** "What Gente learned about you": every skill change, why, and a way back. */
export function LearnedOverlay({
  onClose,
  onOpenSkills,
}: {
  onClose: () => void;
  /** Opens the full skills list, for skills written by hand. */
  onOpenSkills?: () => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const listQuery = useQuery(queries.learning.list.queryOptions());
  const changes = listQuery.data ?? [];
  const act = useSave({
    save: async ({ kind, change }: Action, rpc) => {
      const ref = { skillId: change.skillId, changeId: change.id };
      if (kind === "confirm") return rpc.learning.confirm(ref);
      if (kind === "dismiss") return rpc.learning.dismiss(ref);
      return rpc.learning.undo(ref);
    },
    stale: [queries.learning.list.key(), queries.agentSkills.list.key()],
  });
  const [showEarlier, setShowEarlier] = useState(false);
  const waiting = changes.filter((change) => change.status === "quarantined");
  const live = changes.filter((change) => change.status === "live");
  const earlier = changes.filter(
    (change) => change.status === "rejected" || change.status === "undone",
  );
  const failures: Record<Action["kind"], string> = {
    confirm: t`Couldn't confirm that. Try again.`,
    dismiss: t`Couldn't dismiss that. Try again.`,
    undo: t`Couldn't undo that. Try again.`,
  };
  const actionError =
    act.error && act.input ? errorText(act.error, failures[act.input.kind]) : null;
  const loadError = listQuery.error
    ? t`Couldn't open what I learned. Try again in a moment.`
    : null;
  const busyId = act.pending ? act.input?.change.id : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent showCloseButton={false} size="2xl" className="bg-card">
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <div>
            <DialogTitle className="text-heading2 text-foreground">
              <Trans>What I learned about you</Trans>
            </DialogTitle>
            <p className="mt-1 max-w-[52ch] text-body-sm text-muted-foreground">
              <Trans>Stays on this computer. Undo anything.</Trans>
            </p>
            {onOpenSkills ? (
              <Button variant="link" size="sm" className="mt-1 px-0" onClick={onOpenSkills}>
                <Trans>All skills</Trans>
              </Button>
            ) : null}
          </div>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t`Close`} />}>
            <X />
          </DialogClose>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-8 pt-2 pb-8">
          {actionError || loadError ? (
            <p role="status" className="text-body-sm text-destructive">
              {actionError ?? loadError}
            </p>
          ) : null}
          {listQuery.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : changes.length === 0 && !loadError ? (
            <p className="py-10 text-center text-body-sm text-muted-foreground">
              <Trans>
                Nothing yet. When you tell me how you like things done, it shows up here.
              </Trans>
            </p>
          ) : null}

          {waiting.length > 0 ? (
            <section aria-label={t`Waiting for you`} className="space-y-2">
              <h3 className="text-body-sm font-medium text-foreground">
                <Trans>Waiting for you</Trans>
              </h3>
              {waiting.map((change) => (
                <ChangeCard key={change.id} change={change}>
                  <Button
                    size="sm"
                    disabled={act.pending}
                    onClick={() => act.run({ kind: "confirm", change })}
                  >
                    {busyId === change.id && act.input?.kind === "confirm" ? (
                      <Spinner />
                    ) : (
                      <Trans>Use it</Trans>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={act.pending}
                    onClick={() => act.run({ kind: "dismiss", change })}
                  >
                    <Trans>Dismiss</Trans>
                  </Button>
                </ChangeCard>
              ))}
            </section>
          ) : null}

          {live.length > 0 ? (
            <section aria-label={t`In use`} className="space-y-2">
              <h3 className="text-body-sm font-medium text-foreground">
                <Trans>In use</Trans>
              </h3>
              {live.map((change) => (
                <ChangeCard key={change.id} change={change}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.pending}
                    onClick={() => act.run({ kind: "undo", change })}
                  >
                    {busyId === change.id ? <Spinner /> : <Trans>Undo</Trans>}
                  </Button>
                </ChangeCard>
              ))}
            </section>
          ) : null}

          {earlier.length > 0 ? (
            <section className="space-y-2">
              <button
                type="button"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier((open) => !open)}
                className="flex items-center gap-1 text-body-sm text-muted-foreground hover:text-foreground"
              >
                {showEarlier ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <Trans>Not in use ({earlier.length})</Trans>
              </button>
              {showEarlier
                ? earlier.map((change) => <ChangeCard key={change.id} change={change} />)
                : null}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeCard({ change, children }: { change: LearnedChange; children?: React.ReactNode }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const source = {
    user_feedback: t`From what you said`,
    web_content: t`From outside content`,
    run_outcome: t`From how a task went`,
  }[change.source];
  const date = new Date(change.decidedAt ?? change.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const note =
    change.status === "undone" ? t`Undone.` : change.heldBecause ? change.heldBecause : null;
  return (
    <article
      data-gente-rise
      data-status={change.status}
      className="rounded-2xl border border-border bg-background px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-foreground">{change.reason}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-muted-foreground">
            <span>{change.skillName}</span>
            <span>{source}</span>
            <span>{date}</span>
          </p>
          {note ? <p className="mt-1 text-caption text-muted-foreground">{note}</p> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
      </div>
      {change.diff ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="mt-2 text-caption text-muted-foreground hover:text-foreground"
          >
            {open ? <Trans>Hide the change</Trans> : <Trans>See the change</Trans>}
          </button>
          {open ? <DiffView diff={change.diff} /> : null}
        </>
      ) : null}
    </article>
  );
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff
    .split("\n")
    .filter((line) => line && !line.startsWith("---") && !line.startsWith("+++"));
  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-muted p-3 text-caption leading-relaxed">
      {lines.map((line, index) => (
        <div
          // Lines of one diff never reorder, so their position is their identity.
          key={`${index}:${line}`}
          className={
            line.startsWith("+")
              ? "text-success"
              : line.startsWith("-")
                ? "text-destructive"
                : line.startsWith("@@")
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground"
          }
        >
          {line.startsWith("@@") ? "…" : line}
        </div>
      ))}
    </pre>
  );
}

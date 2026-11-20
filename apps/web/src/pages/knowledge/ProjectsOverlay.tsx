// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, ProjectTaskStatus } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Textarea,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";

const NO_PROJECTS: Project[] = [];
/** A click moves a task one step on; done goes back to to do. */
const NEXT_STATUS: Record<ProjectTaskStatus, ProjectTaskStatus> = {
  todo: "doing",
  doing: "done",
  blocked: "doing",
  done: "todo",
};
const STATUS_DOT: Record<ProjectTaskStatus, string> = {
  todo: "bg-muted-foreground/30",
  doing: "bg-warning",
  blocked: "bg-destructive",
  done: "bg-success",
};

function useStatusLabel() {
  const { t } = useLingui();
  return (status: ProjectTaskStatus | Project["status"]) =>
    ({
      todo: t`To do`,
      doing: t`Doing`,
      blocked: t`Blocked`,
      done: t`Done`,
      active: t`Active`,
      paused: t`Paused`,
    })[status];
}

type ProjectSave =
  | { kind: "create"; name: string }
  | { kind: "task"; id: string; taskId: string; status: ProjectTaskStatus }
  | { kind: "addTask"; id: string; title: string }
  | { kind: "feedback"; id: string; text: string }
  | { kind: "remove"; id: string };

/** A section that stays folded until asked for, so a project opens on what matters now. */
function More({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <section className="mt-4 border-t border-border pt-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ms-2 gap-1 text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown /> : <ChevronRight />}
        {title}
        <span className="text-caption">{count}</span>
      </Button>
      {open ? (
        <div className="mt-2" data-gente-rise>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Projects: goals, tasks the bots move on their own, files, a feedback timeline, and the brains
 * and skills each one uses. The list opens one project at a time; the rest folds away.
 */
export function ProjectsOverlay({
  onClose,
  onOpenBrain,
  initialProjectId,
}: {
  onClose: () => void;
  onOpenBrain?: (slug: string) => void;
  initialProjectId?: string;
}) {
  const { t, i18n } = useLingui();
  const statusLabel = useStatusLabel();
  const queries = useSpaceQueries();
  const list = queries.projects.list.queryOptions();
  const listQuery = useQuery(list);
  const projects = listQuery.data ?? NO_PROJECTS;
  const [openId, setOpenId] = useState<string | null>(initialProjectId ?? null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirming, setConfirming] = useState(false);
  const open = projects.find((project) => project.id === openId) ?? null;
  const change = useSave({
    save: async (input: ProjectSave, rpc) => {
      switch (input.kind) {
        case "create":
          return rpc.projects.create({ name: input.name });
        case "task":
          return rpc.projects.update({
            id: input.id,
            task: { id: input.taskId, status: input.status },
          });
        case "addTask":
          return rpc.projects.update({ id: input.id, addTask: input.title });
        case "feedback":
          return rpc.projects.feedback({ id: input.id, text: input.text });
        case "remove":
          await rpc.projects.remove({ id: input.id });
          return null;
      }
    },
    stale: [list.queryKey],
    onSaved: (saved, input) => {
      if (input.kind === "create" && saved) {
        setNaming(false);
        setName("");
        setOpenId(saved.id);
      }
      if (input.kind === "addTask") setTaskTitle("");
      if (input.kind === "feedback") setFeedback("");
      if (input.kind === "remove") {
        setOpenId(null);
        setConfirming(false);
      }
    },
  });
  const failure = change.error
    ? t`That didn't go through. Try again.`
    : listQuery.isError
      ? t`Couldn't load your projects. Try again.`
      : null;
  const busy = change.pending;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

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
        data-testid="projects-overlay"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <div>
            <DialogTitle className="text-heading2 text-foreground">
              <Trans>Projects</Trans>
            </DialogTitle>
            <p className="mt-1 max-w-[52ch] text-body-sm text-muted-foreground">
              <Trans>Gente keeps each project's tasks up to date as it works.</Trans>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!open && !naming ? (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setNaming(true)}>
                <Plus />
                <Trans>New project</Trans>
              </Button>
            ) : null}
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label={t`Close projects`} />}
            >
              <X />
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="rk-scroll flex-1 overflow-y-auto px-8 py-6">
          {failure ? (
            <div className="mb-4 flex items-center gap-3" role="status">
              <p className="text-body-sm text-muted-foreground">{failure}</p>
              {listQuery.isError ? (
                <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                  <Trans>Retry</Trans>
                </Button>
              ) : null}
            </div>
          ) : null}
          {naming ? (
            <form
              className="mb-4 flex gap-2"
              data-gente-rise
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) change.run({ kind: "create", name: name.trim() });
              }}
            >
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label={t`Project name`}
                placeholder={t`What are you working on?`}
                maxLength={120}
              />
              <Button type="submit" disabled={busy || !name.trim()}>
                <Trans>Start</Trans>
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNaming(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </form>
          ) : null}
          {listQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="gente-skeleton h-14 w-full rounded-xl" />
              <Skeleton className="gente-skeleton h-14 w-full rounded-xl" />
            </div>
          ) : open ? (
            <div data-gente-rise key={open.id} data-testid="project-detail">
              <Button
                variant="ghost"
                size="sm"
                className="-ms-2 mb-3 gap-1"
                onClick={() => setOpenId(null)}
              >
                <ChevronLeft />
                <Trans>All projects</Trans>
              </Button>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-heading3 text-foreground" dir="auto">
                  {open.name}
                </h3>
                <span className="text-body-sm text-muted-foreground">
                  {statusLabel(open.status)}
                </span>
              </div>
              {open.goals.length ? (
                <ul className="mt-2 space-y-1 text-body text-muted-foreground">
                  {open.goals.map((goal) => (
                    <li key={goal} dir="auto">
                      {goal}
                    </li>
                  ))}
                </ul>
              ) : null}

              <section className="mt-5">
                <h4 className="text-body-sm font-medium text-muted-foreground">
                  <Trans>Tasks</Trans>
                </h4>
                <ul className="mt-2 space-y-1">
                  {open.tasks.map((task) => (
                    <li key={task.id}>
                      <Button
                        variant="ghost"
                        className="h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-start"
                        disabled={busy}
                        aria-label={t`${task.title}: ${statusLabel(task.status)}. Move to ${statusLabel(NEXT_STATUS[task.status])}`}
                        onClick={() =>
                          change.run({
                            kind: "task",
                            id: open.id,
                            taskId: task.id,
                            status: NEXT_STATUS[task.status],
                          })
                        }
                      >
                        <span
                          aria-hidden
                          className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-body ${task.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}
                          dir="auto"
                        >
                          {task.title}
                        </span>
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {statusLabel(task.status)}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (taskTitle.trim())
                      change.run({ kind: "addTask", id: open.id, title: taskTitle.trim() });
                  }}
                >
                  <Input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    aria-label={t`New task`}
                    placeholder={t`Add a task`}
                    maxLength={200}
                    size="sm"
                  />
                  {taskTitle.trim() ? (
                    <Button type="submit" size="sm" disabled={busy}>
                      <Trans>Add</Trans>
                    </Button>
                  ) : null}
                </form>
              </section>

              <section className="mt-5">
                <h4 className="text-body-sm font-medium text-muted-foreground">
                  <Trans>Feedback</Trans>
                </h4>
                <Textarea
                  className="mt-2 w-full"
                  rows={2}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  aria-label={t`Feedback`}
                  placeholder={t`Tell Gente what to keep or change`}
                  maxLength={1000}
                  dir="auto"
                />
                {feedback.trim() ? (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={() =>
                      change.run({ kind: "feedback", id: open.id, text: feedback.trim() })
                    }
                  >
                    <Trans>Send feedback</Trans>
                  </Button>
                ) : null}
              </section>

              <More title={<Trans>Timeline</Trans>} count={open.timeline.length}>
                <ol className="space-y-2" data-testid="project-timeline">
                  {[...open.timeline].reverse().map((entry) => (
                    <li key={`${entry.at}:${entry.text}`} className="flex gap-3 text-body-sm">
                      <span className="w-28 shrink-0 text-muted-foreground">{when(entry.at)}</span>
                      <span className="min-w-0 text-foreground" dir="auto">
                        {entry.by === "user" ? <Trans>You:</Trans> : <Trans>Gente:</Trans>}{" "}
                        {entry.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </More>
              <More title={<Trans>Files and assets</Trans>} count={open.assets.length}>
                <ul className="space-y-1 text-body">
                  {open.assets.map((asset) => (
                    <li key={asset.artifactId ?? asset.url ?? asset.name} dir="auto">
                      {asset.url ? (
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {asset.name}
                        </a>
                      ) : (
                        asset.name
                      )}
                    </li>
                  ))}
                </ul>
              </More>
              <More
                title={<Trans>Brains and skills</Trans>}
                count={open.brainSlugs.length + open.skillNames.length}
              >
                <div className="flex flex-wrap gap-2">
                  {open.brainSlugs.map((slug) => (
                    <Button
                      key={slug}
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={() => onOpenBrain?.(slug)}
                    >
                      {slug.replace(/-/g, " ")}
                    </Button>
                  ))}
                  {open.skillNames.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full border border-border px-3 py-1 text-body-sm text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </More>
              <div className="mt-6">
                <Button
                  variant={confirming ? "destructive" : "ghost"}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    confirming ? change.run({ kind: "remove", id: open.id }) : setConfirming(true)
                  }
                >
                  {confirming ? <Trans>Delete for good</Trans> : <Trans>Delete project</Trans>}
                </Button>
              </div>
            </div>
          ) : projects.length === 0 && !naming && !listQuery.isError ? (
            <p
              className="py-6 text-center text-body text-muted-foreground"
              data-testid="projects-empty"
            >
              <Trans>No projects yet. Start one, or ask Gente to start one in a chat.</Trans>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {projects.map((project) => {
                const done = project.tasks.filter((task) => task.status === "done").length;
                return (
                  <li key={project.id} data-gente-rise>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-between rounded-xl px-3 py-3 text-start"
                      onClick={() => {
                        setOpenId(project.id);
                        setConfirming(false);
                        change.reset();
                      }}
                    >
                      <span className="min-w-0 truncate text-body text-foreground" dir="auto">
                        {project.name}
                      </span>
                      <span className="shrink-0 text-body-sm text-muted-foreground">
                        {project.tasks.length
                          ? t`${done} of ${project.tasks.length} done`
                          : statusLabel(project.status)}
                      </span>
                    </Button>
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

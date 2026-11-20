// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { BrainCitation, BrainEntry } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Textarea,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, X } from "lucide-react";
import { useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";

const NO_BRAINS: BrainEntry[] = [];

/** Where a fact came from, in a word or two, never an id. */
function CitationChip({ citation }: { citation: BrainCitation }) {
  const { t } = useLingui();
  const chip = "rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground";
  if (citation.kind === "url") {
    let host = citation.ref;
    try {
      host = new URL(citation.ref).hostname.replace(/^www\./, "");
    } catch {
      // Keep the address as written.
    }
    return (
      <a
        href={citation.ref}
        target="_blank"
        rel="noreferrer"
        className={`${chip} hover:text-foreground`}
      >
        {host}
      </a>
    );
  }
  const label =
    citation.kind === "user"
      ? t`you`
      : citation.kind === "project"
        ? t`project feedback`
        : citation.kind === "file"
          ? (citation.label ?? t`a file`)
          : citation.label?.startsWith("web_search")
            ? t`web search`
            : t`your chat`;
  return <span className={chip}>{label}</span>;
}

function updatedLabel(iso: string, locale?: string) {
  return new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

type BrainChange =
  | { kind: "save"; brain: BrainEntry; content: string }
  | { kind: "remove"; brain: BrainEntry };

/**
 * What Gente learned, one topic per brain. Each brain opens to its facts with their sources; the
 * file itself is one more click away for editing, and deleting asks once more.
 */
export function BrainsOverlay({
  onClose,
  initialSlug,
}: {
  onClose: () => void;
  initialSlug?: string;
}) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const list = queries.brains.list.queryOptions();
  const listQuery = useQuery(list);
  const brains = listQuery.data ?? NO_BRAINS;
  const [openSlug, setOpenSlug] = useState<string | null>(initialSlug ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const open = brains.find((brain) => brain.slug === openSlug) ?? null;
  const change = useSave({
    save: async (input: BrainChange, rpc) => {
      if (input.kind === "remove") return rpc.brains.remove({ id: input.brain.id });
      return rpc.brains.update({
        id: input.brain.id,
        content: input.content,
        expectedRevision: input.brain.revision,
      });
    },
    stale: [list.queryKey],
    onSaved: (_saved, input) => {
      setEditing(false);
      setConfirming(false);
      if (input.kind === "remove") setOpenSlug(null);
    },
  });
  const failure = change.error
    ? change.input?.kind === "remove"
      ? t`Couldn't delete that. Try again.`
      : t`Couldn't save. Open it again and retry.`
    : listQuery.isError
      ? t`Couldn't load your brains. Try again.`
      : null;

  function show(brain: BrainEntry | null) {
    setOpenSlug(brain?.slug ?? null);
    setEditing(false);
    setConfirming(false);
    change.reset();
  }

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
        data-testid="brains-overlay"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <div>
            <DialogTitle className="text-heading2 text-foreground">
              <Trans>Brains</Trans>
            </DialogTitle>
            <p className="mt-1 max-w-[52ch] text-body-sm text-muted-foreground">
              <Trans>
                What Gente learned on each topic, with where it learned it. Stays on this computer.
              </Trans>
            </p>
          </div>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close brains`} />}
          >
            <X />
          </DialogClose>
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
          {listQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="gente-skeleton h-12 w-full rounded-xl" />
              <Skeleton className="gente-skeleton h-12 w-full rounded-xl" />
            </div>
          ) : open ? (
            <div data-gente-rise key={open.slug}>
              <Button
                variant="ghost"
                size="sm"
                className="-ms-2 mb-3 gap-1"
                onClick={() => show(null)}
              >
                <ChevronLeft />
                <Trans>All brains</Trans>
              </Button>
              <h3 className="text-heading3 text-foreground" dir="auto">
                {open.topic}
              </h3>
              {editing ? (
                <div className="mt-3">
                  <Textarea
                    aria-label={t`Brain file`}
                    value={draft}
                    disabled={change.pending}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={Math.min(20, Math.max(6, draft.split("\n").length + 1))}
                    className="w-full font-mono text-body-sm leading-relaxed"
                    dir="auto"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={change.pending}
                      onClick={() => change.run({ kind: "save", brain: open, content: draft })}
                    >
                      <Trans>Save</Trans>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      <Trans>Cancel</Trans>
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="mt-3 space-y-2.5">
                    {open.facts.map((fact) => (
                      <li
                        key={`${fact.text}:${fact.addedAt}`}
                        className="text-body text-foreground"
                        data-gente-rise
                        dir="auto"
                      >
                        <span>{fact.text}</span>{" "}
                        <span className="inline-flex flex-wrap gap-1 align-middle">
                          {fact.citations.map((citation) => (
                            <CitationChip
                              key={`${citation.kind}:${citation.ref}`}
                              citation={citation}
                            />
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDraft(open.content);
                        setEditing(true);
                        change.reset();
                      }}
                    >
                      <Trans>Edit</Trans>
                    </Button>
                    <Button
                      variant={confirming ? "destructive" : "ghost"}
                      size="sm"
                      disabled={change.pending}
                      onClick={() =>
                        confirming
                          ? change.run({ kind: "remove", brain: open })
                          : setConfirming(true)
                      }
                    >
                      {confirming ? <Trans>Delete for good</Trans> : <Trans>Delete</Trans>}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : brains.length === 0 && !listQuery.isError ? (
            <p
              className="py-6 text-center text-body text-muted-foreground"
              data-testid="brains-empty"
            >
              <Trans>
                Nothing here yet. When Gente researches something or hears your feedback, it keeps
                notes here.
              </Trans>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {brains.map((brain) => (
                <li key={brain.id} data-gente-rise>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-xl px-3 py-3 text-start"
                    onClick={() => show(brain)}
                  >
                    <span className="min-w-0 truncate text-body text-foreground" dir="auto">
                      {brain.topic}
                    </span>
                    <span className="flex shrink-0 gap-3 text-body-sm text-muted-foreground">
                      <span>
                        <Plural value={brain.facts.length} one="# note" other="# notes" />
                      </span>
                      <span>{updatedLabel(brain.updatedAt, i18n.locale)}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

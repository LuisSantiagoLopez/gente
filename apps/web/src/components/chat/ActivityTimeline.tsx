// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Inside the arrow, once opened: the real streamed thoughts in small muted type, between the
// real tool steps, in the order they happened. While the AI works, the thought being written
// and the file being written stream at the end. No filler rows, no totals.
// Rendered by ActivityLine.tsx; each tool step is ActivityStep.tsx.
import { memo, useLayoutEffect, useRef } from "react";
import { toolDraftPreview } from "../../lib/chat/tool-draft";
import { draftTitle } from "../../lib/chat-v2/activity-summary";
import type { AssistantView } from "../../lib/chat-v2/chat-types";
import { ActivityStep } from "./ActivityStep";

/** Keeps a growing box scrolled to its newest line unless the reader scrolled up in it. */
function useFollowEnd<T extends HTMLElement>(content: string) {
  const ref = useRef<T | null>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [content]);
  const onScroll = () => {
    const element = ref.current;
    if (element)
      pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };
  return { ref, onScroll };
}

function Thought({ text, live }: { text: string; live?: boolean }) {
  const follow = useFollowEnd<HTMLDivElement>(text);
  return (
    <div
      ref={follow.ref}
      onScroll={follow.onScroll}
      data-testid={live ? "live-thought" : "activity-thought"}
      className="max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground/80"
      dir="auto"
    >
      {text}
    </div>
  );
}

function ToolDraftView({ name, args }: { name: string; args: string }) {
  const preview = toolDraftPreview(args);
  const follow = useFollowEnd<HTMLPreElement>(preview.body);
  return (
    <div className="flex flex-col gap-1" data-testid="live-tool-draft">
      <span className="text-foreground/80">{draftTitle(name, args)}…</span>
      {preview.body ? (
        <pre
          ref={follow.ref}
          onScroll={follow.onScroll}
          className="max-h-56 overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-label whitespace-pre-wrap break-words text-foreground/75"
        >
          {preview.body}
        </pre>
      ) : null}
    </div>
  );
}

export const ActivityTimeline = memo(function ActivityTimeline({
  view,
  now,
}: {
  view: AssistantView;
  now: number;
}) {
  return (
    <div
      data-testid="activity-timeline"
      className="ms-[30px] mt-1.5 mb-1 flex max-w-xl flex-col gap-2 text-body-sm"
    >
      {view.steps.map((step) =>
        step.kind === "thought" ? (
          <Thought key={step.id} text={step.text} />
        ) : (
          <ActivityStep key={step.id} step={step} now={now} />
        ),
      )}
      {view.liveThought ? <Thought text={view.liveThought} live /> : null}
      {view.toolDraft ? (
        <ToolDraftView name={view.toolDraft.name} args={view.toolDraft.args} />
      ) : null}
    </div>
  );
});

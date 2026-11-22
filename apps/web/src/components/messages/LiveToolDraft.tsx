// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A tool call's file or code while the model is still writing it, such as "Writing index.html".
// Shown as the last entry of the reply's activity timeline (RunActivityTimeline.tsx).
import { useLingui } from "@lingui/react/macro";
import { useLayoutEffect, useRef } from "react";
import { toolDraftPreview } from "../../lib/chat/tool-draft";

/** Keeps a growing box scrolled to its newest line unless the reader scrolled up in it. */
export function useFollowEnd<T extends HTMLElement>(content: string) {
  const ref = useRef<T | null>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [content]);
  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };
  return { ref, onScroll };
}

export function LiveToolDraft({ args }: { args: string }) {
  const { t } = useLingui();
  const preview = toolDraftPreview(args);
  const follow = useFollowEnd<HTMLPreElement>(preview.body);
  const title = preview.path
    ? t`Writing ${preview.path}`
    : preview.isBody
      ? t`Writing`
      : t`Preparing a step`;
  return (
    <div className="flex flex-col gap-1" data-testid="live-tool-draft">
      <span className="text-foreground/85">{title}</span>
      <pre
        ref={follow.ref}
        onScroll={follow.onScroll}
        className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1 font-mono whitespace-pre-wrap break-words text-foreground/80"
      >
        {preview.body}
      </pre>
    </div>
  );
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { toolDraftPreview } from "../../lib/chat/tool-draft";

type ProgressBlock = Extract<MessageBlock, { kind: "progress" }>;

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
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };
  return { ref, onScroll };
}

/**
 * Gente: what the model is writing before its reply, live: its thinking in a section that folds
 * away once the reply starts, and a tool call's file or code as it is generated.
 */
export function LiveDraft({ block }: { block: ProgressBlock }) {
  if (!block.thinking && !block.toolDraft) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="live-draft">
      {block.thinking ? (
        <LiveThinking text={block.thinking} answering={Boolean(block.text.trim())} />
      ) : null}
      {block.toolDraft ? <LiveToolDraft args={block.toolDraft.args} /> : null}
    </div>
  );
}

function LiveThinking({ text, answering }: { text: string; answering: boolean }) {
  const follow = useFollowEnd<HTMLDivElement>(text);
  return (
    // Open while it is the newest thing written; it folds once the reply starts.
    <Collapsible
      key={answering ? "answering" : "thinking"}
      defaultOpen={!answering}
      className="group"
    >
      <CollapsibleTrigger className="flex min-h-6 w-fit cursor-pointer items-center gap-1 rounded-md py-0.5 pe-1.5 text-body-sm font-medium text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <Trans>Thinking</Trans>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={follow.ref}
          onScroll={follow.onScroll}
          className="ms-[7px] mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap border-s border-border ps-3 text-body-sm text-muted-foreground"
          dir="auto"
        >
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LiveToolDraft({ args }: { args: string }) {
  const { t } = useLingui();
  const preview = toolDraftPreview(args);
  const follow = useFollowEnd<HTMLPreElement>(preview.body);
  const title = preview.path
    ? t`Writing ${preview.path}`
    : preview.isBody
      ? t`Writing`
      : t`Preparing a step`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm font-medium text-muted-foreground">{title}</span>
      <pre
        ref={follow.ref}
        onScroll={follow.onScroll}
        className="max-h-64 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-body-sm whitespace-pre-wrap break-words text-foreground"
      >
        {preview.body}
      </pre>
    </div>
  );
}

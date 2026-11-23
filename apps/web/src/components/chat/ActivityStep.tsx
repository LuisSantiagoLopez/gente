// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// One tool step in the opened arrow: a tiny icon, a plain verb ("Wrote index.html",
// "Searched the web") and how long it took. Click it to see what went in and what came out.
// Rendered by ActivityTimeline.tsx.
import { Trans } from "@lingui/react/macro";
import { formatCompactDuration } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import type { LucideIcon } from "lucide-react";
import {
  FilePen,
  FileText,
  Folder,
  Globe,
  LoaderCircle,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useState } from "react";
import type { StepIcon } from "../../lib/chat-v2/activity-summary";
import { stepIcon, stepVerb } from "../../lib/chat-v2/activity-summary";
import type { ToolStep } from "../../lib/chat-v2/chat-types";

const ICONS: Record<StepIcon, LucideIcon> = {
  file: FilePen,
  read: FileText,
  search: Search,
  web: Globe,
  terminal: SquareTerminal,
  ask: MessageCircleQuestion,
  folder: Folder,
  tool: Wrench,
};

/** Characters of an input or output shown before "Show more". */
const PREVIEW_CHARS = 400;

function Detail({ label, text }: { label: ReactNode; text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-label whitespace-pre-wrap break-words text-foreground/80">
        {long && !all ? `${text.slice(0, PREVIEW_CHARS)}…` : text}
      </pre>
      {long ? (
        <Button variant="text" size="xs" className="w-fit font-normal" onClick={() => setAll(!all)}>
          {all ? <Trans>Show less</Trans> : <Trans>Show more</Trans>}
        </Button>
      ) : null}
    </div>
  );
}

export const ActivityStep = memo(function ActivityStep({
  step,
  now,
}: {
  step: ToolStep;
  now: number;
}) {
  const running = step.status === "running";
  const Icon = running ? LoaderCircle : step.status === "failed" ? X : ICONS[stepIcon(step)];
  const took = running
    ? step.startedAt !== undefined
      ? formatCompactDuration(Math.max(0, now - step.startedAt))
      : null
    : formatCompactDuration(step.durationMs);
  const details = Boolean(step.input || step.output);
  return (
    <Collapsible className="group/step" data-testid="activity-step">
      <CollapsibleTrigger
        disabled={!details}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-start text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <Icon
          aria-hidden
          className={`size-3 shrink-0 ${running ? "animate-spin" : ""} ${step.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        />
        <span className="min-w-0 truncate">{stepVerb(step)}</span>
        {took ? (
          <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">{took}</span>
        ) : null}
      </CollapsibleTrigger>
      {details ? (
        <CollapsibleContent className="mt-1 flex flex-col gap-1.5 ps-[18px]">
          {step.input ? <Detail label={<Trans>Input</Trans>} text={step.input} /> : null}
          {step.output ? <Detail label={<Trans>Output</Trans>} text={step.output} /> : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
});

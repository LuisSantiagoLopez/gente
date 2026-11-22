// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The inside of a reply's activity row, opened from its arrow: real thoughts in small muted
// type and real tool steps as compact rows, in the order they happened. A step opens to show
// its input and output. While the run is live, the newest thinking and the file being written
// stream at the end. Rendered by RunActivityRow.tsx.
import { Trans, useLingui } from "@lingui/react/macro";
import type { RunActivityStep } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { Check, CircleSlash, LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { pastTenseLabel } from "../../lib/chat/run-activity-steps";
import { LiveToolDraft, useFollowEnd } from "./LiveToolDraft";

/** Characters of a step's input or output shown before "Show more". */
const PREVIEW_CHARS = 240;

function elapsed(startedAt: string, endAt: number): number | undefined {
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, endAt - start) : undefined;
}

export function RunActivityTimeline({
  steps,
  now,
  liveThinking,
  liveToolDraft,
}: {
  steps: readonly RunActivityStep[];
  now: number;
  /** Thinking streaming now, not yet saved as a step. */
  liveThinking?: string;
  /** A tool call's arguments while the model writes them. */
  liveToolDraft?: string;
}) {
  return (
    <div
      className="ms-[30px] mt-1 flex flex-col gap-2 text-body-sm"
      data-testid="run-activity-timeline"
    >
      {steps.map((step) =>
        step.kind === "thought" ? (
          <Thought key={step.id} text={step.output ?? ""} />
        ) : (
          <ToolStep key={step.id} step={step} now={now} />
        ),
      )}
      {liveThinking ? <Thought text={liveThinking} live /> : null}
      {liveToolDraft ? <LiveToolDraft args={liveToolDraft} /> : null}
    </div>
  );
}

function Thought({ text, live }: { text: string; live?: boolean }) {
  const follow = useFollowEnd<HTMLDivElement>(text);
  return (
    <div
      ref={live ? follow.ref : undefined}
      onScroll={live ? follow.onScroll : undefined}
      className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground"
      dir="auto"
      data-testid="activity-thought"
    >
      {text}
    </div>
  );
}

function StatusIcon({ status }: { status: RunActivityStep["status"] }) {
  const { t } = useLingui();
  const className = "size-3 shrink-0";
  if (status === "running")
    return <LoaderCircle aria-label={t`Running`} className={`${className} animate-spin`} />;
  if (status === "succeeded") return <Check aria-label={t`Done`} className={className} />;
  if (status === "failed")
    return <X aria-label={t`Failed`} className={`${className} text-destructive`} />;
  return <CircleSlash aria-label={t`Stopped`} className={className} />;
}

function ToolStep({ step, now }: { step: RunActivityStep; now: number }) {
  const running = step.status === "running";
  const duration = formatCompactDuration(running ? elapsed(step.startedAt, now) : step.durationMs);
  const label = running ? step.label : pastTenseLabel(step.label);
  const details = Boolean(step.input || step.output);
  return (
    <Collapsible className="group/step" data-testid="activity-step">
      <CollapsibleTrigger
        disabled={!details}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-start text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <StatusIcon status={step.status} />
        <span className="min-w-0 truncate">{label}</span>
        {duration ? (
          <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">{duration}</span>
        ) : null}
      </CollapsibleTrigger>
      {details ? (
        <CollapsibleContent className="mt-1 flex flex-col gap-1.5 ps-[18px]">
          {step.input ? <StepText label={<Trans>Input</Trans>} text={step.input} /> : null}
          {step.output ? <StepText label={<Trans>Output</Trans>} text={step.output} /> : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function StepText({ label, text }: { label: ReactNode; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1 font-mono whitespace-pre-wrap break-words text-foreground/80">
        {long && !expanded ? `${text.slice(0, PREVIEW_CHARS)}…` : text}
      </pre>
      {long ? (
        <Button
          variant="text"
          size="xs"
          onClick={() => setExpanded((value) => !value)}
          className="w-fit font-normal"
        >
          {expanded ? <Trans>Show less</Trans> : <Trans>Show more</Trans>}
        </Button>
      ) : null}
    </div>
  );
}

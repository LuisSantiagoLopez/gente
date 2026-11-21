// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The inside of a reply's activity row, opened from its arrow: one timeline in the order things
// happened. Thinking and tool steps take turns; each step shows its input, output and time.
// While the run is live the newest thinking and the file being written stream at the end.
// Rendered by RunActivityRow.tsx.
import { Trans, useLingui } from "@lingui/react/macro";
import type { RunActivityStep } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { Check, CircleSlash, LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { LiveToolDraft, useFollowEnd } from "./LiveToolDraft";

/** Characters of a step's input or output shown before "Show more". */
const PREVIEW_CHARS = 240;

export function elapsed(startedAt: string | undefined, endAt: number): number | undefined {
  if (!startedAt) return undefined;
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
  const empty = steps.length === 0 && !liveThinking && !liveToolDraft;
  return (
    <div
      className="ms-[7px] mt-1 flex flex-col gap-2 border-s border-border ps-3 text-body-sm"
      data-testid="run-activity-timeline"
    >
      {empty ? (
        <span className="text-muted-foreground">
          <Trans>Reading your message</Trans>
        </span>
      ) : null}
      {steps.map((step) =>
        step.kind === "thought" ? (
          <Thought key={step.id} text={step.output ?? ""} durationMs={step.durationMs} />
        ) : (
          <ToolStep key={step.id} step={step} now={now} />
        ),
      )}
      {liveThinking ? <Thought text={liveThinking} live /> : null}
      {liveToolDraft ? <LiveToolDraft args={liveToolDraft} /> : null}
    </div>
  );
}

function Thought({
  text,
  durationMs,
  live,
}: {
  text: string;
  durationMs?: number;
  live?: boolean;
}) {
  const follow = useFollowEnd<HTMLDivElement>(text);
  const duration = formatCompactDuration(durationMs);
  return (
    <div className="flex flex-col gap-0.5" data-testid="activity-thought">
      <span className="flex items-center gap-1.5 text-foreground/85">
        {live ? <Trans>Thinking</Trans> : <Trans>Thought</Trans>}
        {duration ? (
          <span className="ms-auto text-muted-foreground tabular-nums">{duration}</span>
        ) : null}
      </span>
      <div
        ref={live ? follow.ref : undefined}
        onScroll={live ? follow.onScroll : undefined}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap text-muted-foreground"
        dir="auto"
      >
        {text}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: RunActivityStep["status"] }) {
  const { t } = useLingui();
  const className = "size-3.5 shrink-0";
  if (status === "running")
    return <LoaderCircle aria-label={t`Running`} className={`${className} animate-spin`} />;
  if (status === "succeeded") return <Check aria-label={t`Done`} className={className} />;
  if (status === "failed")
    return <X aria-label={t`Failed`} className={`${className} text-destructive`} />;
  return <CircleSlash aria-label={t`Stopped`} className={className} />;
}

function ToolStep({ step, now }: { step: RunActivityStep; now: number }) {
  const duration = formatCompactDuration(
    step.status === "running" ? elapsed(step.startedAt, now) : step.durationMs,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-foreground/85">
        <StatusIcon status={step.status} />
        <span className="min-w-0 truncate">{step.label}</span>
        {duration ? (
          <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">{duration}</span>
        ) : null}
      </div>
      {step.input ? <StepText label={<Trans>Input</Trans>} text={step.input} /> : null}
      {step.output ? <StepText label={<Trans>Output</Trans>} text={step.output} /> : null}
    </div>
  );
}

function StepText({ label, text }: { label: ReactNode; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  return (
    <div className="ms-5 flex flex-col gap-0.5">
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

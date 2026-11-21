// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import type { RunActivity, RunActivityStep } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { Check, ChevronRight, CircleSlash, LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

/** Lines of a step's input or output shown before "Show more". */
const PREVIEW_CHARS = 240;

function elapsed(startedAt: string | undefined, endAt: number): number | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, endAt - start) : undefined;
}

/**
 * Gente: the run's working line with a chevron that opens what it is doing step by step: each
 * tool in plain words, its input and output, how it ended and how long it took, plus the run's
 * total time and tokens. It stays openable under the reply once the run ends.
 */
export function RunActivityRow({
  activity,
  live,
  children,
}: {
  activity: RunActivity | undefined;
  live: boolean;
  /** The working line shown beside the chevron while the run is live. */
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const steps = activity?.steps ?? [];
  const now = useNow(live ? 250 : null);
  const endAt = activity?.endedAt ? Date.parse(activity.endedAt) : now;
  const total = formatCompactDuration(elapsed(activity?.startedAt, endAt));
  if (!live && steps.length === 0) return null;
  return (
    <Collapsible className="group" data-testid="run-activity">
      <div className="flex items-center gap-1">
        <CollapsibleTrigger
          aria-label={t`Show steps`}
          className="flex min-h-6 cursor-pointer items-center gap-1 rounded-md py-0.5 pe-1.5 text-body-sm text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            size={14}
            strokeWidth={1.8}
            className="transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
          />
          {live ? null : (
            <span className="flex items-center gap-2">
              <Plural value={steps.length} one="# step" other="# steps" />
              {total ? <span>{total}</span> : null}
            </span>
          )}
        </CollapsibleTrigger>
        {live ? children : null}
      </div>
      <CollapsibleContent>
        <div className="ms-[7px] mt-1 flex flex-col gap-2 border-s border-border ps-3 text-body-sm">
          {steps.length === 0 ? (
            <span className="text-muted-foreground">
              <Trans>Thinking about what to do</Trans>
            </span>
          ) : (
            steps.map((step) => <ActivityStep key={step.id} step={step} now={now} />)
          )}
          <div className="flex gap-3 text-muted-foreground">
            {total ? (
              <span>
                <Trans>Total {total}</Trans>
              </span>
            ) : null}
            {activity?.tokens ? (
              <span>
                <Plural value={activity.tokens} one="# token" other="# tokens" />
              </span>
            ) : null}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
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

function ActivityStep({ step, now }: { step: RunActivityStep; now: number }) {
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

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The one arrow under each reply, like ChatGPT's. Closed, it reads "Thought for 4s" or
// "Worked for 52s · 3 steps". Open, it shows the timeline of thinking and steps
// (RunActivityTimeline.tsx). It is live while the run works and stays openable afterwards.
// Rendered by the chat transcript (pages/shell/chat/transcript.tsx), once per run.
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import type { RunActivity } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  runActivitySteps,
  thoughtMs,
  toolStepCount,
  unsavedThinking,
} from "../../lib/chat/run-activity-steps";
import { elapsed, RunActivityTimeline } from "./RunActivityTimeline";

/** What the model is writing right now, from the run's live progress. */
export type LiveRunDraft = { thinking?: string; toolDraft?: { name: string; args: string } };

export function RunActivityRow({
  activity,
  live,
  draft,
  children,
}: {
  activity: RunActivity | undefined;
  live: boolean;
  /** Live only: the thinking and tool arguments streaming now. */
  draft?: LiveRunDraft;
  /** The working line shown beside the arrow while the run is live. */
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const toolSteps = toolStepCount(activity);
  const steps = runActivitySteps(activity, {
    read: t`Read your message`,
    reply: t`Wrote the reply`,
  });
  const now = useNow(live ? 250 : null);
  const endAt = activity?.endedAt ? Date.parse(activity.endedAt) : now;
  const total = formatCompactDuration(elapsed(activity?.startedAt, endAt));
  const thought = formatCompactDuration(thoughtMs(activity, now));
  const liveThinking = live ? unsavedThinking(activity, draft?.thinking) : "";
  // Every run gets its arrow, a plain "hey" too, live and after it ends.
  if (!live && !activity?.startedAt) return null;
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
          {live && children ? null : (
            <span className="flex items-center gap-2" data-testid="run-activity-summary">
              {toolSteps > 0 ? (
                total ? (
                  <Plural
                    value={toolSteps}
                    one={`Worked for ${total} · # step`}
                    other={`Worked for ${total} · # steps`}
                  />
                ) : (
                  <Plural value={toolSteps} one="# step" other="# steps" />
                )
              ) : thought ? (
                <Trans>Thought for {thought}</Trans>
              ) : (
                <Trans>Thinking</Trans>
              )}
            </span>
          )}
        </CollapsibleTrigger>
        {live ? children : null}
      </div>
      <CollapsibleContent>
        <RunActivityTimeline
          steps={steps}
          now={now}
          liveThinking={liveThinking}
          liveToolDraft={live ? draft?.toolDraft?.args : undefined}
        />
        <div className="ms-[7px] flex gap-3 ps-3 pt-1 text-body-sm text-muted-foreground">
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
      </CollapsibleContent>
    </Collapsible>
  );
}

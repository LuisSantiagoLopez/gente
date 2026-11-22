// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The one arrow for each reply: a small muted line beside the bot's figure, above the reply.
// Working, it reads "Thinking…" with a soft shimmer and a faded one-line preview of the newest
// thought. Done, it reads "Thought for 31s ›" or "Worked for 31s · 3 steps ›". Open, it shows
// the timeline of thoughts and tool steps (RunActivityTimeline.tsx).
// Rendered by the chat transcript (pages/shell/chat/transcript.tsx), once per run.
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import type { RunActivity } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { GroupAvatar } from "@rakazo/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import {
  activityTimeline,
  latestThought,
  runningStepLabel,
  thoughtMs,
  toolStepCount,
  unsavedThinking,
  workedMs,
} from "../../lib/chat/run-activity-steps";
import { RunActivityTimeline } from "./RunActivityTimeline";

/** What the model is writing right now, from the run's live progress. */
export type LiveRunDraft = { thinking?: string; toolDraft?: { name: string; args: string } };

export function RunActivityRow({
  activity,
  live,
  draft,
  bots,
  liveLabel,
}: {
  activity: RunActivity | undefined;
  live: boolean;
  /** Live only: the thinking and tool arguments streaming now. */
  draft?: LiveRunDraft;
  /** The figure beside the line: the bot (or bots) doing the work. */
  bots: GroupAvatarMember[];
  /** Live only: a line to show in place of "Thinking…", such as a routine's name. */
  liveLabel?: string;
}) {
  const { t } = useLingui();
  const now = useNow(live ? 250 : null);
  const tools = toolStepCount(activity);
  const liveThinking = live ? unsavedThinking(activity, draft?.thinking) : "";
  const steps = activityTimeline(activity);
  const running = live ? runningStepLabel(activity) : undefined;
  const preview = live ? latestThought(activity, liveThinking) : "";
  const worked = formatCompactDuration(workedMs(activity, now));
  const thought = formatCompactDuration(thoughtMs(activity, now));
  if (!live && !activity?.startedAt) return null;
  const openable = steps.length > 0 || Boolean(liveThinking) || Boolean(draft?.toolDraft);
  return (
    <Collapsible className="group my-1" data-testid="run-activity">
      <div className="flex min-w-0 items-center gap-2">
        {bots.length ? <GroupAvatar members={bots} size={22} /> : null}
        <CollapsibleTrigger
          aria-label={t`Show what it did`}
          disabled={!openable}
          className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md py-0.5 text-body-sm text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <span
            className={`shrink-0 ${live ? "text-shimmer" : ""}`}
            data-testid="run-activity-summary"
          >
            {live ? (
              (running ?? liveLabel ?? <Trans>Thinking…</Trans>)
            ) : tools > 0 && worked ? (
              <Plural
                value={tools}
                one={`Worked for ${worked} · # step`}
                other={`Worked for ${worked} · # steps`}
              />
            ) : thought ? (
              <Trans>Thought for {thought}</Trans>
            ) : (
              <Trans>Done</Trans>
            )}
          </span>
          {openable ? (
            <ChevronRight
              aria-hidden
              size={13}
              strokeWidth={1.8}
              className="shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
            />
          ) : null}
          {preview ? (
            <span
              className="min-w-0 truncate text-muted-foreground/60 group-data-panel-open:hidden"
              dir="auto"
            >
              {preview}
            </span>
          ) : null}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <RunActivityTimeline
          steps={steps}
          now={now}
          liveThinking={liveThinking}
          liveToolDraft={live ? draft?.toolDraft?.args : undefined}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

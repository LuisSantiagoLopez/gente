// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The one arrow: a quiet line beside the AI's avatar, above its reply.
// - Working: "Thinking…" with a soft pulse and the newest thought faded beside it, live; or
//   "Writing index.html…" with a timer while a file is written.
// - Done: "Thought for 4s ›" or "Worked for 52s · 3 steps ›". Nothing at all when there is
//   nothing to open.
// - Open: the timeline of real thoughts and steps (ActivityTimeline.tsx).
// The words come from lib/chat-v2/activity-summary.ts. Rendered by AssistantTurn.tsx.
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import { formatCompactDuration } from "@rakazo/core";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { GroupAvatar } from "@rakazo/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rakazo/ui-web/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { memo } from "react";
import { activitySummary } from "../../lib/chat-v2/activity-summary";
import type { AssistantView } from "../../lib/chat-v2/chat-types";
import { ActivityTimeline } from "./ActivityTimeline";

function Avatar({ bots }: { bots: GroupAvatarMember[] }) {
  return bots.length ? <GroupAvatar members={bots} size={22} /> : <span className="w-[22px]" />;
}

export const ActivityLine = memo(function ActivityLine({
  view,
  bots,
}: {
  view: AssistantView;
  bots: GroupAvatarMember[];
}) {
  const { t } = useLingui();
  const live = view.status === "working";
  const now = useNow(live ? 250 : null);
  const summary = activitySummary(view, now);
  if (summary.kind === "hidden") return <Avatar bots={bots} />;
  const timer =
    summary.kind === "working" && summary.since !== undefined
      ? formatCompactDuration(Math.max(0, now - summary.since))
      : null;
  const took = summary.kind === "done" ? (formatCompactDuration(summary.ms) ?? "0s") : "";
  return (
    <Collapsible className="group min-w-0" data-testid="activity-line">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar bots={bots} />
        <CollapsibleTrigger
          aria-label={t`Show what it did`}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-body-sm text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span data-testid="activity-summary" className={`shrink-0 ${live ? "text-shimmer" : ""}`}>
            {summary.kind === "working" ? (
              summary.label === "Thinking…" ? (
                <Trans>Thinking…</Trans>
              ) : (
                summary.label
              )
            ) : summary.kind === "waiting" ? (
              <Trans>Waiting for your answer</Trans>
            ) : summary.tools > 0 ? (
              <Plural
                value={summary.tools}
                one={`Worked for ${took} · # step`}
                other={`Worked for ${took} · # steps`}
              />
            ) : (
              <Trans>Thought for {took}</Trans>
            )}
          </span>
          {timer ? <span className="shrink-0 tabular-nums">{timer}</span> : null}
          <ChevronRight
            aria-hidden
            size={13}
            strokeWidth={1.8}
            className="shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
          />
          {summary.kind === "working" && summary.preview ? (
            <span
              data-testid="activity-preview"
              className="min-w-0 truncate text-muted-foreground/60 group-data-panel-open:hidden"
              dir="auto"
            >
              {summary.preview}
            </span>
          ) : null}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ActivityTimeline view={view} now={now} />
      </CollapsibleContent>
    </Collapsible>
  );
});

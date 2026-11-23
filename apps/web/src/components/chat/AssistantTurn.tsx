// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The AI's answer in one turn: the one arrow beside its avatar (ActivityLine.tsx), then its
// reply text (ReplyText.tsx) and any cards (CardMessage.tsx) in the order they came.
// Nothing about thinking is drawn inside the reply. Rendered by MessageList.tsx.
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { memo } from "react";
import type { AssistantView } from "../../lib/chat-v2/chat-types";
import { ActivityLine } from "./ActivityLine";
import { CardMessage } from "./CardMessage";
import { ReplyText } from "./ReplyText";

export const AssistantTurn = memo(function AssistantTurn({
  view,
  bots,
}: {
  view: AssistantView;
  bots: GroupAvatarMember[];
}) {
  const items = [
    ...view.parts.map((part) => ({
      kind: "text" as const,
      key: part.key,
      order: part.order,
      part,
    })),
    ...view.cards.map((card) => ({
      kind: "card" as const,
      key: card.key,
      order: card.order,
      card,
    })),
  ].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-2" data-testid="assistant-turn" data-gente-msg="theirs">
      {view.runId ? <ActivityLine view={view} bots={bots} /> : null}
      {items.map((item) =>
        item.kind === "text" ? (
          <ReplyText
            key={item.key}
            text={item.part.text}
            streaming={item.part.streaming}
            message={item.part.message}
          />
        ) : (
          <CardMessage key={item.key} message={item.card.message} />
        ),
      )}
      {view.status === "failed" && view.error && items.length === 0 ? (
        <p className="text-body-sm text-destructive" data-testid="turn-error">
          {view.error}
        </p>
      ) : null}
    </div>
  );
});

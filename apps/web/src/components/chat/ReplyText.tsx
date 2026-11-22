// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// One piece of the AI's reply, drawn as markdown in a bubble. The same element shows the text
// from the first streamed token to the saved message: its key never changes (chat-turns.ts),
// and only the `streaming` flag flips at the end, so nothing remounts or replays. Once saved,
// hovering shows copy, reply and reactions. Rendered by AssistantTurn.tsx.
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { ThreadMessage } from "@rakazo/contracts";
import { memo } from "react";
import { useOpenPage } from "../../lib/pages/pages";
import { MessageHoverActions } from "../../pages/shell/chat/message-hover-actions";
import { useChatActions } from "./CardMessage";

export const ReplyText = memo(function ReplyText({
  text,
  streaming,
  message,
}: {
  text: string;
  streaming: boolean;
  message?: ThreadMessage;
}) {
  const openPage = useOpenPage();
  const actions = useChatActions();
  return (
    <div
      className="group/message relative w-fit max-w-[min(88%,39rem)]"
      data-message-id={message?.id}
    >
      <div
        data-testid="reply-text"
        data-streaming={streaming ? "true" : "false"}
        data-quote-message-id={message?.id}
        className="rounded-2xl bg-muted px-4 py-2.5 text-body-lg text-foreground"
        dir="auto"
      >
        <ChatMarkdown streaming={streaming} onOpenPage={openPage}>
          {text}
        </ChatMarkdown>
      </div>
      {message && !streaming ? (
        <MessageHoverActions
          message={message}
          side="end"
          onReply={actions.base.onReply}
          onMarkUnread={actions.base.onMarkUnread}
          markedUnread={message.id === actions.markedUnreadMessageId}
          onReact={actions.base.onReact}
        />
      ) : null}
    </div>
  );
});

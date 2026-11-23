// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The person's own message, right-aligned in their color. Plain text shows in the bubble;
// a message with attachments or other parts uses the card drawing (CardMessage.tsx).
// Rendered by MessageList.tsx.
import type { ThreadMessage } from "@rakazo/contracts";
import { memo } from "react";
import { MessageHoverActions } from "../../pages/shell/chat/message-hover-actions";
import { CardMessage, useChatActions } from "./CardMessage";

export const UserBubble = memo(function UserBubble({ message }: { message: ThreadMessage }) {
  const actions = useChatActions();
  const plain = message.blocks.every((block) => block.kind === "text");
  const text = message.blocks
    .map((block) => (block.kind === "text" ? block.text : ""))
    .join("\n\n");
  return (
    <div
      className="group/message relative flex justify-end"
      data-message-id={message.id}
      data-gente-msg="mine"
    >
      {plain ? (
        <div
          data-testid="user-bubble"
          data-quote-message-id={message.id}
          className="w-fit max-w-[min(84%,39rem)] rounded-2xl bg-chat-user px-4 py-2.5 text-body-lg whitespace-pre-wrap break-words text-chat-user-foreground"
          dir="auto"
        >
          {text}
        </div>
      ) : (
        <CardMessage message={message} />
      )}
      {plain ? (
        <MessageHoverActions
          message={message}
          side="start"
          onReply={actions.base.onReply}
          onMarkUnread={actions.base.onMarkUnread}
          markedUnread={message.id === actions.markedUnreadMessageId}
          onReact={actions.base.onReact}
        />
      ) : null}
    </div>
  );
});

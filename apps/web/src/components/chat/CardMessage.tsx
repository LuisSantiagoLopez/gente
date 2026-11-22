// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A saved message that is more than text: a question card (AskCard), a page, a computer, a
// file, a helper. It reuses the existing card drawing (pages/shell/chat/message-view.tsx) with
// the chat's actions from context. Rendered by AssistantTurn.tsx and UserBubble.tsx.
import type { ThreadMessage } from "@rakazo/contracts";
import type { ComponentProps } from "react";
import { createContext, memo, useContext } from "react";
import { MessageView } from "../../pages/shell/chat/message-view";

type MessageViewProps = ComponentProps<typeof MessageView>;

/** What every card needs from the chat screen, set once by MessageList.tsx. */
export type ChatActions = {
  base: Omit<
    MessageViewProps,
    "message" | "canAnswer" | "canDismiss" | "speaking" | "markedUnread"
  >;
  answerableAskIds: ReadonlySet<string>;
  dismissableAskIds: ReadonlySet<string>;
  speakingMessageId: string | null;
  markedUnreadMessageId?: string;
};

export const ChatActionsContext = createContext<ChatActions | null>(null);

export function useChatActions(): ChatActions {
  const actions = useContext(ChatActionsContext);
  if (!actions) throw new Error("ChatActionsContext is missing");
  return actions;
}

/** Cards that fill the column; other cards keep the bubble's width. */
function isWide(message: ThreadMessage) {
  return message.blocks.some((block) =>
    ["ask", "mcp_approval", "tool_question", "app_connect", "page", "computer"].includes(
      block.kind,
    ),
  );
}

export const CardMessage = memo(function CardMessage({ message }: { message: ThreadMessage }) {
  const actions = useChatActions();
  return (
    <div
      data-message-id={message.id}
      data-testid="chat-card"
      className={isWide(message) ? "w-full max-w-xl min-w-0" : "w-fit max-w-[min(88%,39rem)]"}
    >
      <MessageView
        {...actions.base}
        message={message}
        canAnswer={actions.answerableAskIds.has(message.id)}
        canDismiss={actions.dismissableAskIds.has(message.id)}
        speaking={actions.speakingMessageId === message.id}
        markedUnread={message.id === actions.markedUnreadMessageId}
      />
    </div>
  );
});

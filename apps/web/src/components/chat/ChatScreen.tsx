// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The open chat, as the app shell hands it over: gathers the actions every card needs
// (answering a question card, opening a page or a computer, reacting) once, then draws the
// list of turns (MessageList.tsx). Rendered by pages/Shell.tsx.
import type { ComponentProps } from "react";
import { memo, useMemo } from "react";
import type { ChatActions } from "./CardMessage";
import { MessageList } from "./MessageList";

type ListProps = ComponentProps<typeof MessageList>;

export type ChatScreenProps = Omit<ListProps, "actions"> &
  ChatActions["base"] &
  Pick<
    ChatActions,
    "answerableAskIds" | "dismissableAskIds" | "speakingMessageId" | "markedUnreadMessageId"
  >;

export const ChatScreen = memo(function ChatScreen(props: ChatScreenProps) {
  const {
    snapshot,
    threadId,
    scrollRef,
    followRequest,
    scrollRequest,
    onScrollRequestHandled,
    olderCursor,
    loadingOlder,
    onLoadOlder,
    workingBots,
    runBot,
    userBubble,
    onQuote,
    onQuoteShortcutChange,
    answerableAskIds,
    dismissableAskIds,
    speakingMessageId,
    markedUnreadMessageId,
    ...base
  } = props;
  // Rebuilt only when an action changes, so cards do not draw again on every streamed token.
  const actions = useMemo<ChatActions>(
    () => ({ base, answerableAskIds, dismissableAskIds, speakingMessageId, markedUnreadMessageId }),
    [
      base.artifactTarget,
      base.meId,
      base.onAnswer,
      base.onOpenBot,
      base.onOpenPeerMessages,
      base.memberName,
      base.peerBot,
      base.onJumpToMessage,
      base.onRefresh,
      base.onBotChanged,
      base.onAddRoutine,
      base.voiceReady,
      base.callHoldsSpeaker,
      base.onSpeak,
      base.onOpenComputer,
      base.onReleaseComputer,
      base.onOpenImportSetup,
      base.rpc,
      base.showToolActivity,
      base.onReply,
      base.onMarkUnread,
      base.onReact,
      answerableAskIds,
      dismissableAskIds,
      speakingMessageId,
      markedUnreadMessageId,
    ],
  );
  return (
    <MessageList
      snapshot={snapshot}
      threadId={threadId}
      scrollRef={scrollRef}
      followRequest={followRequest}
      scrollRequest={scrollRequest}
      onScrollRequestHandled={onScrollRequestHandled}
      olderCursor={olderCursor}
      loadingOlder={loadingOlder}
      onLoadOlder={onLoadOlder}
      workingBots={workingBots}
      runBot={runBot}
      userBubble={userBubble}
      actions={actions}
      onQuote={onQuote}
      onQuoteShortcutChange={onQuoteShortcutChange}
    />
  );
});

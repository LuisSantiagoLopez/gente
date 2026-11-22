// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The chat's scrolling list of turns: the person's message (UserBubble.tsx), then the AI's
// answer (AssistantTurn.tsx). The turns come from lib/chat-v2/use-chat-state.ts, which folds
// the live event stream. Keeps the newest line in view only while the reader is at the bottom
// (use-follow-bottom.ts), loads older messages on request, and jumps to a message when asked.
// Rendered by pages/Shell.tsx, once per open chat.
import { useLingui } from "@lingui/react/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import type { GroupAvatarMember } from "@rakazo/ui-web";
import { Button, Spinner } from "@rakazo/ui-web";
import { ArrowDown } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { TRANSCRIPT_CONTENT_PADDING } from "../../lib/chat/transcript-layout";
import type { ChatSnapshot } from "../../lib/chat-v2/chat-snapshot";
import { useChatState } from "../../lib/chat-v2/use-chat-state";
import { playSound } from "../../lib/gente/sounds";
import { QuoteSelectionButton } from "../../pages/shell/chat/quote-selection-button";
import { AssistantTurn } from "./AssistantTurn";
import type { ChatActions } from "./CardMessage";
import { ChatActionsContext } from "./CardMessage";
import { UserBubble } from "./UserBubble";
import { useFollowBottom } from "./use-follow-bottom";
import { useQuoteSelection } from "./use-quote-selection";

export const MessageList = memo(function MessageList({
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
  actions,
  onQuote,
  onQuoteShortcutChange,
}: {
  snapshot: ChatSnapshot | null | undefined;
  threadId: string | undefined;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Changes when the person sends: the view moves to the end and follows the reply. */
  followRequest: number;
  scrollRequest: { messageId: string; nonce: number } | null;
  onScrollRequestHandled: () => void;
  olderCursor: number | null;
  loadingOlder: boolean;
  onLoadOlder: () => void | Promise<void>;
  /** The bots working now, beside a live answer. */
  workingBots: GroupAvatarMember[];
  /** The figure beside a finished answer. */
  runBot?: (botId: string | undefined) => GroupAvatarMember[];
  /** The person's bubbles take the bot's color in its own chat. */
  userBubble?: { background: string; foreground: string };
  actions: ChatActions;
  /** Selecting text in a message offers to quote it in the reply. */
  onQuote?: (message: ThreadMessage, quote: string) => void;
  onQuoteShortcutChange?: (handler: (() => boolean) | null) => void;
}) {
  const { t } = useLingui();
  const chat = useChatState(snapshot, threadId);
  const contentRef = useRef<HTMLDivElement>(null);
  const follow = useFollowBottom(scrollRef, contentRef, followRequest);
  const messageById = useMemo(() => {
    const byId = new Map<string, ThreadMessage>();
    for (const turn of chat.turns) {
      if (turn.user) byId.set(turn.user.id, turn.user);
      for (const part of turn.assistant?.parts ?? [])
        if (part.message) byId.set(part.message.id, part.message);
    }
    return byId;
  }, [chat.turns]);
  const quote = useQuoteSelection(messageById, onQuote, onQuoteShortcutChange);

  // A soft chime when an answer finishes.
  const working = chat.turns.some((turn) => turn.assistant?.status === "working");
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) {
      playSound("arrive");
      globalThis.dispatchEvent(new CustomEvent("gente:reply"));
    }
    wasWorking.current = working;
  }, [working]);

  // A jump to a message (search, a reply's quote) scrolls it to the middle and flashes it.
  const jumped = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!scrollRequest || jumped.current === scrollRequest.nonce) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(scrollRequest.messageId)}"]`,
    );
    if (!row) return;
    jumped.current = scrollRequest.nonce;
    follow.following.current = false;
    row.scrollIntoView({ behavior: "auto", block: "center" });
    row.animate(
      [
        { backgroundColor: "transparent" },
        { backgroundColor: "var(--muted)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 1200 },
    );
    onScrollRequestHandled();
  }, [chat, scrollRequest, scrollRef, onScrollRequestHandled, follow.following]);

  const avatarFor = useMemo(
    () => (botId: string | undefined, live: boolean) => {
      if (live) {
        const mine = workingBots.filter((bot) => bot.botId === botId);
        return mine.length ? mine : workingBots;
      }
      return runBot?.(botId) ?? workingBots;
    },
    [workingBots, runBot],
  );

  const loadOlder = () => {
    follow.holdPlace();
    void Promise.resolve(onLoadOlder()).catch(() => undefined);
  };

  return (
    <ChatActionsContext.Provider value={actions}>
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="transcript"
          {...follow.scrollHandlers}
          className={`rk-scroll isolate flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-20 pb-12 md:pt-[84px] md:pb-13 ${TRANSCRIPT_CONTENT_PADDING}`}
          style={
            userBubble
              ? ({
                  "--chat-user": userBubble.background,
                  "--chat-user-foreground": userBubble.foreground,
                } as CSSProperties)
              : undefined
          }
        >
          <div ref={contentRef} className="flex flex-col gap-5" data-testid="message-list">
            {olderCursor != null ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingOlder}
                onClick={loadOlder}
                className="self-center text-muted-foreground"
              >
                {loadingOlder ? <Spinner aria-label={t`Loading…`} /> : null}
                {t`Load earlier messages`}
              </Button>
            ) : null}
            {chat.turns.map((turn) => (
              <section key={turn.id} className="flex flex-col gap-3" data-turn-id={turn.id}>
                {turn.user ? <UserBubble message={turn.user} /> : null}
                {turn.assistant ? (
                  <AssistantTurn
                    view={turn.assistant}
                    bots={avatarFor(turn.assistant.botId, turn.assistant.status === "working")}
                  />
                ) : null}
              </section>
            ))}
          </div>
        </div>
        {quote.range ? <QuoteSelectionButton range={quote.range} onQuote={quote.apply} /> : null}
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Jump to latest`}
          aria-hidden={follow.atEnd}
          tabIndex={follow.atEnd ? -1 : 0}
          onClick={() => follow.toEnd(true)}
          className={`absolute bottom-11 left-1/2 z-20 -translate-x-1/2 shadow-md transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
            follow.atEnd ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100"
          }`}
        >
          <ArrowDown strokeWidth={1.8} className="size-[17px]" />
        </Button>
      </div>
    </ChatActionsContext.Provider>
  );
});

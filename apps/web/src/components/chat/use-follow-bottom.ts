// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Auto-scroll for the chat: while the reader is at the bottom, new text keeps the newest line
// in view; once they scroll up, nothing moves until they come back down (or send a message).
// Also keeps the reader's place when older messages are added above.
// Used by MessageList.tsx.
import type { KeyboardEvent, RefObject, UIEvent, WheelEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { transcriptIsNearEnd } from "../../lib/chat/transcript-scroll";

export function useFollowBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  followRequest: number,
) {
  const following = useRef(true);
  const lastTop = useRef(0);
  const [atEnd, setAtEnd] = useState(true);
  // When older messages are added above, the first row must stay where it was.
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const toEnd = useCallback(
    (smooth = false) => {
      const element = scrollRef.current;
      if (!element) return;
      following.current = true;
      setAtEnd(true);
      element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    },
    [scrollRef],
  );

  // Content that grows (a streamed token, an opened timeline) keeps a following reader at the end.
  useEffect(() => {
    const content = contentRef.current;
    const element = scrollRef.current;
    if (!content || !element) return;
    const observer = new ResizeObserver(() => {
      const held = anchor.current;
      if (held) {
        anchor.current = null;
        element.scrollTop = held.top + (element.scrollHeight - held.height);
        return;
      }
      if (following.current) element.scrollTop = element.scrollHeight;
      else setAtEnd(transcriptIsNearEnd(element));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, scrollRef]);

  // Sending a message always brings the reader to the end.
  const handled = useRef(followRequest);
  useLayoutEffect(() => {
    if (handled.current === followRequest) return;
    handled.current = followRequest;
    toEnd();
  }, [followRequest, toEnd]);

  // The first paint opens at the newest message.
  useLayoutEffect(() => toEnd(), [toEnd]);

  const scrollHandlers = {
    onWheel: (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) following.current = false;
    },
    onTouchMove: () => {
      following.current = false;
    },
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const near = transcriptIsNearEnd(element);
      setAtEnd(near);
      // Moving up away from the end (a scrollbar drag) stops following; reaching it resumes.
      if (near) following.current = true;
      else if (element.scrollTop < lastTop.current) following.current = false;
      lastTop.current = element.scrollTop;
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (["PageUp", "ArrowUp", "Home"].includes(event.key)) following.current = false;
    },
  };

  /** Call before older messages are added so the view stays put. */
  const holdPlace = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = false;
    anchor.current = { height: element.scrollHeight, top: element.scrollTop };
  }, [scrollRef]);

  return { atEnd, toEnd, holdPlace, scrollHandlers, following };
}

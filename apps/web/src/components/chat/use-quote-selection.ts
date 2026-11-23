// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Selecting text inside one message offers a "Quote" pill (QuoteSelectionButton) and the quote
// shortcut. Works on any element marked `data-quote-message-id` (ReplyText.tsx, UserBubble.tsx).
// Used by MessageList.tsx.
import type { ThreadMessage } from "@rakazo/contracts";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  isDetachedRange,
  lastSelectedText,
  quoteDraftForSelection,
} from "../../lib/chat/quote-selection";
import { useEventListener } from "../../lib/use-event-listener";
import { isEditableTarget } from "../../pages/shell/shell-shortcuts";

type Draft = { message: ThreadMessage; text: string; range: Range; rangeText: string };

const contentOf = (node: Node) =>
  (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    "[data-quote-message-id]",
  ) ?? null;

export function useQuoteSelection(
  messageById: ReadonlyMap<string, ThreadMessage>,
  onQuote?: (message: ThreadMessage, quote: string) => void,
  onQuoteShortcutChange?: (handler: (() => boolean) | null) => void,
) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const mouseDown = useRef(false);

  const evaluate = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setDraft(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const startContent = contentOf(range.startContainer);
    const endContent = contentOf(lastSelectedText(range));
    const found = quoteDraftForSelection(
      {
        startContent,
        endContent,
        text: startContent && startContent === endContent ? selection.toString() : "",
      },
      messageById,
    );
    setDraft(found ? { ...found, range, rangeText: range.toString() } : null);
  }, [messageById]);

  const apply = useCallback(() => {
    const selection = window.getSelection();
    if (!draft || !onQuote || !selection || selection.isCollapsed) return false;
    if (isDetachedRange(draft.range) || draft.range.toString() !== draft.rangeText) return false;
    onQuote(draft.message, draft.text);
    selection.removeAllRanges();
    setDraft(null);
    return true;
  }, [draft, onQuote]);

  useLayoutEffect(() => {
    onQuoteShortcutChange?.(
      draft ? () => !isEditableTarget(document.activeElement) && apply() : null,
    );
    return () => onQuoteShortcutChange?.(null);
  }, [onQuoteShortcutChange, apply, draft]);

  useEventListener(
    document,
    "mousedown",
    (event) => {
      mouseDown.current = true;
      if ((event.target as Element | null)?.closest?.("[data-quote-selection]")) return;
      setDraft(null);
    },
    true,
  );
  useEventListener(
    document,
    "mouseup",
    () => {
      mouseDown.current = false;
      evaluate();
    },
    true,
  );
  useEventListener(document, "selectionchange", () => {
    if (!mouseDown.current) evaluate();
  });
  useEventListener(document, "keydown", (event) => {
    if (event.key === "Escape") setDraft(null);
  });
  useEventListener(window, "blur", () => {
    mouseDown.current = false;
  });

  return { range: onQuote ? draft?.range : undefined, apply };
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { useTimeout } from "@rakazo/chat-ui/hooks";
import { useEffect, useRef, useState } from "react";
import { useEventListener } from "../use-event-listener";

type Point = { kind: "click" | "move"; x: number; y: number };
type Ripple = { id: number; x: number; y: number };

/**
 * Over a bot's live screen: the bot's cursor (a marigold dot that glides to each point) and a
 * soft ring on every click. Positions are fractions of the screen, so any panel size works.
 */
export function PointerOverlay({
  botId,
  screenWidth,
  screenHeight,
}: {
  botId: string;
  /** The remote screen's size; the view fits it inside the panel, so marks follow that box. */
  screenWidth?: number;
  screenHeight?: number;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || !screenWidth || !screenHeight) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const scale = Math.min(width / screenWidth, height / screenHeight);
      const w = screenWidth * scale;
      const h = screenHeight * scale;
      setFit({ left: (width - w) / 2, top: (height - h) / 2, width: w, height: h });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [screenWidth, screenHeight]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextRipple = useRef(0);
  // Rings fade out over 900 ms (gente-motion.css); clear them once the latest one has finished.
  useTimeout(() => setRipples([]), ripples.length ? 900 : null, ripples.at(-1)?.id);
  useEventListener(globalThis as EventTarget, "gente:pointer", (event) => {
    const detail = (event as CustomEvent).detail as {
      botId: string;
      points?: Point[];
      width?: number;
      height?: number;
    };
    if (detail.botId !== botId || !detail.width || !detail.height) return;
    for (const point of detail.points ?? []) {
      const at = { x: point.x / detail.width, y: point.y / detail.height };
      setCursor(at);
      if (point.kind === "click") {
        const id = ++nextRipple.current;
        setRipples((current) => [...current.slice(-4), { id, ...at }]);
      }
    }
  });
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden" data-gente-pointer="">
      <div
        className="absolute"
        style={fit ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height } : { inset: 0 }}
      >
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="gente-click-ripple absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary"
          style={{ left: `${ripple.x * 100}%`, top: `${ripple.y * 100}%` }}
        />
      ))}
      {cursor ? (
        <span
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_2px_white] transition-[left,top] duration-300 ease-out"
          style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
        />
      ) : null}
      </div>
    </div>
  );
}

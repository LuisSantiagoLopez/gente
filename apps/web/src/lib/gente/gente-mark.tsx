// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { useState } from "react";
import { useEventListener } from "../use-event-listener";
import { handMarkDots } from "./hand-drawn";

/** Eight hand-drawn dots in a ring: people gathered. One marigold dot is you. */
const DOTS = handMarkDots(24);

/** The Gente mark. It breathes while idle and hops once when a reply lands. */
export function GenteMark({ size = 22 }: { size?: number }) {
  const [hop, setHop] = useState(0);
  useEventListener(globalThis as EventTarget, "gente:reply", () => setHop((n) => n + 1));
  return (
    <svg
      key={hop}
      data-gente-mark=""
      data-gente-hop={hop > 0 ? "" : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Gente"
    >
      {DOTS.map((dot) => (
        <path key={dot.d} d={dot.d} fill={dot.accent ? "var(--primary)" : "currentColor"} />
      ))}
    </svg>
  );
}

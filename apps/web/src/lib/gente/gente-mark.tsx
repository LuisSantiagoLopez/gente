// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { useEffect, useState } from "react";

/** Eight dots in a ring: people gathered. One marigold dot is you. */
const DOTS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { x: 12 + Math.cos(angle) * 8, y: 12 + Math.sin(angle) * 8, accent: i === 0 };
});

/** The Gente mark. It breathes while idle and hops once when a reply lands. */
export function GenteMark({ size = 22 }: { size?: number }) {
  const [hop, setHop] = useState(0);
  useEffect(() => {
    const onReply = () => setHop((n) => n + 1);
    globalThis.addEventListener("gente:reply", onReply);
    return () => globalThis.removeEventListener("gente:reply", onReply);
  }, []);
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
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.accent ? 2.6 : 2.1}
          fill={dot.accent ? "var(--primary)" : "currentColor"}
        />
      ))}
    </svg>
  );
}

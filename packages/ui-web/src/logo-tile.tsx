// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// An app's logo on a neutral plate with small rounded corners. The logo sits inside with about
// 15% padding and keeps its shape (contain, never scaled past its box, never masked by the
// plate's corners). Round plates get a little more padding, since a square fits inside a circle
// only with ~15% per side. Sources are tried in order; the first letter shows only when none load.
import { useState } from "react";
import { cn } from "./lib/utils.js";

export function LogoTile({
  name,
  logo,
  sources,
  size = 36,
  shape = "rounded",
  className,
  onError,
}: {
  name: string;
  /** One logo; or pass `sources` to try several in order. */
  logo?: string | null;
  sources?: readonly string[];
  /** The plate's width and height in pixels. */
  size?: number;
  shape?: "rounded" | "round";
  className?: string;
  /** Called when the last source can't load (after which the first letter shows). */
  onError?: () => void;
}) {
  const list = sources ?? (logo ? [logo] : []);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const src = list.find((source) => !failed.has(source));
  const inset = Math.round(size * (shape === "round" ? 0.18 : 0.15));
  const inner = size - 2 * inset;
  return (
    <span
      aria-hidden="true"
      data-logo-tile
      className={cn(
        // Clipping here only trims the plate's own background at its corners: the logo below sits
        // in a smaller box inside the padding, so it never reaches the edge.
        "relative grid shrink-0 place-items-center overflow-hidden bg-favicon-plate font-semibold text-foreground outline-1 -outline-offset-1 outline-border/60 dark:text-background",
        shape === "round" ? "rounded-full" : "rounded-[20%]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {src ? (
        <span data-logo-box className="block" style={{ width: inner, height: inner }}>
          <img
            key={src}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            // A fixed box at 100%: an SVG without a viewBox or a large bitmap can't render at its
            // own size, and nothing is scaled or pulled outside the box.
            className="block h-full w-full max-h-full max-w-full object-contain"
            onError={() => {
              const next = new Set(failed).add(src);
              setFailed(next);
              if (list.every((source) => next.has(source))) onError?.();
            }}
          />
        </span>
      ) : (
        (Array.from(name.trim())[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

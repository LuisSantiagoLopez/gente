// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// An app's logo on a light plate. The plate is rounded; the logo sits inside it with padding and
// keeps its shape (contain, never scaled past its box), so square logos are never cut at the
// corners. Round plates get more padding: a square fits inside a circle only with ~15% per side.
import { useState } from "react";
import { cn } from "./lib/utils.js";

export function LogoTile({
  name,
  logo,
  size = 36,
  shape = "rounded",
  className,
  onError,
}: {
  name: string;
  logo?: string | null;
  /** The plate's width and height in pixels. */
  size?: number;
  shape?: "rounded" | "round";
  className?: string;
  /** Called when the logo can't load (after which the first letter shows). */
  onError?: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = Boolean(logo) && failed !== logo;
  const inset = Math.round(size * (shape === "round" ? 0.18 : 0.14));
  return (
    <span
      aria-hidden="true"
      data-logo-tile
      className={cn(
        "grid shrink-0 place-items-center bg-favicon-plate font-semibold text-foreground outline-1 -outline-offset-1 outline-border/60 dark:text-background",
        shape === "round" ? "rounded-full" : "rounded-[28%]",
        className,
      )}
      style={{ width: size, height: size, padding: inset, fontSize: Math.round(size * 0.45) }}
    >
      {showLogo ? (
        <img
          src={logo ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block max-h-full max-w-full object-contain"
          onError={() => {
            setFailed(logo ?? null);
            onError?.();
          }}
        />
      ) : (
        (Array.from(name.trim())[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

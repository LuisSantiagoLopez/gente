// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Small hand-made shapes for the 10% of Gente that is drawn by hand: the mark, empty states and
// onboarding art. Shapes are wobbly but fixed (seeded), so they look the same on every render.

/** A tiny repeatable random number generator. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A filled dot that looks drawn with a marker: slightly lumpy, smoothly closed. */
export function handDotPath(cx: number, cy: number, r: number, seed: number, wobble = 0.14): string {
  const rand = seeded(seed);
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3;
    const rr = r * (1 + (rand() - 0.5) * 2 * wobble);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  });
  const mid = (p: readonly [number, number], q: readonly [number, number]) =>
    [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
  const f = (v: number) => v.toFixed(2);
  const start = mid(pts[n - 1]!, pts[0]!);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % n]!);
    d += ` Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d} Z`;
}

/** Eight dots in a ring, as if drawn by hand: people gathered. The first one is you. */
export function handMarkDots(size = 24) {
  const c = size / 2;
  const ring = size / 3;
  const rand = seeded(7);
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2 + (rand() - 0.5) * 0.12;
    const radius = ring * (1 + (rand() - 0.5) * 0.08);
    const accent = i === 0;
    const r = (accent ? 2.7 : 2.15) * (size / 24);
    return {
      d: handDotPath(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius, r, 11 + i * 17),
      accent,
    };
  });
}

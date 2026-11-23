// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Reads the desktop app's Cloud GPU state (polling, fast while a GPU starts) and offers the
// switch and prewarm. Null outside the desktop app or on releases without Cloud GPU.
// Who calls it: apps/web/src/pages/shell/composer/CloudGpuToggle.tsx and Shell.tsx.
import type { GenteCloudGpuState } from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { pollDelay } from "./cloud-gpu-status";

function bridge() {
  const gente = typeof window === "undefined" ? undefined : window.rakazoDesktop?.gente;
  return gente?.cloudGpu && gente.setCloudGpu ? gente : null;
}

export function useCloudGpu() {
  const [state, setState] = useState<GenteCloudGpuState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const gente = bridge();
    if (!gente?.cloudGpu) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await gente.cloudGpu!().catch(() => null);
      if (stopped) return;
      setState(next);
      setNow(Date.now());
      timer = setTimeout(() => void tick(), pollDelay(next));
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  const setOn = useCallback(async (on: boolean) => {
    const gente = bridge();
    if (!gente?.setCloudGpu) return;
    setState(await gente.setCloudGpu(on));
  }, []);
  const prewarm = useCallback(() => {
    void bridge()
      ?.prewarmCloudGpu?.()
      .catch(() => undefined);
  }, []);
  return { state, now, setOn, prewarm };
}

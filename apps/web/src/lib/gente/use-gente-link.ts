// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// While the app is open and a phone is paired, take the phone's messages from the desktop app
// every 1.5 seconds and act on them (see link-bridge.ts).
import { useEffect, useRef } from "react";
import { desktopBridge } from "../platform/desktop";
import type { LinkRpc } from "./link-bridge";
import { createLinkBridge } from "./link-bridge";

export function useGenteLink(rpc: unknown, navigate: (path: string) => void, enabled: boolean) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const gente = desktopBridge()?.gente;
    if (!enabled || !gente?.linkTake || !gente.linkSend) return;
    const take = gente.linkTake;
    const send = gente.linkSend;
    const bridge = createLinkBridge({
      rpc: rpc as LinkRpc,
      send: (message) => send(message).catch(() => false),
      navigate: (path) => navigateRef.current(path),
    });
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        for (const message of await take().catch(() => []))
          await bridge.handle(message).catch(() => undefined);
        if (bridge.pendingTasks()) await bridge.watch().catch(() => undefined);
      })().finally(() => {
        busy = false;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [rpc, enabled]);
}

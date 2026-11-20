// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// While the app is open and a phone is paired, take the phone's messages from the desktop app
// every 1.5 seconds and act on them (see link-bridge.ts).
import { useNow } from "@rakazo/chat-ui/hooks";
import { useEffect, useMemo, useRef } from "react";
import { desktopBridge } from "../platform/desktop";
import type { LinkRpc } from "./link-bridge";
import { createLinkBridge } from "./link-bridge";

export function useGenteLink(rpc: unknown, navigate: (path: string) => void, enabled: boolean) {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const gente = enabled ? desktopBridge()?.gente : undefined;
  const take = gente?.linkTake;
  const send = gente?.linkSend;
  const bridge = useMemo(
    () =>
      take && send
        ? createLinkBridge({
            rpc: rpc as LinkRpc,
            send: (message) => send(message).catch(() => false),
            navigate: (path) => navigateRef.current(path),
          })
        : null,
    [rpc, take, send],
  );
  const tick = useNow(bridge ? 1500 : null);
  const busy = useRef(false);
  useEffect(() => {
    if (!bridge || !take || busy.current) return;
    busy.current = true;
    void (async () => {
      for (const message of await take().catch(() => []))
        await bridge.handle(message).catch(() => undefined);
      if (bridge.pendingTasks()) await bridge.watch().catch(() => undefined);
    })().finally(() => {
      busy.current = false;
    });
  }, [bridge, take, tick]);
}

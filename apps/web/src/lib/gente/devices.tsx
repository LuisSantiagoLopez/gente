// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Settings → Devices: pair your phone with this computer (Gente Link v1).
import { Trans } from "@lingui/react/macro";
import type { GenteLinkState } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useNow } from "@rakazo/chat-ui/hooks";
import { useEffect, useState } from "react";
import { desktopBridge } from "../platform/desktop";
import { useSave } from "../query/query";

export function DevicesSettingsPanel() {
  const gente = desktopBridge()?.gente;
  const [state, setState] = useState<GenteLinkState | null>(null);
  // The phone pairs (or unpairs) from its own screen; look again every 2 seconds while open.
  const tick = useNow(gente?.linkState ? 2000 : null);
  useEffect(() => {
    if (!gente?.linkState) return;
    let alive = true;
    void gente.linkState().then(
      (next) => alive && setState(next),
      () => undefined, // the next tick asks again
    );
    return () => {
      alive = false;
    };
  }, [gente, tick]);
  const action = useSave({
    save: (call: () => Promise<GenteLinkState>) => call(),
    onSaved: setState,
  });
  if (!gente?.linkState || !state) return null;
  const { phoneName, code } = state;
  const busy = action.pending;
  const act = (call: () => Promise<GenteLinkState>) => action.run(call);

  return (
    <div className="flex flex-col gap-4" data-gente-devices={state.status}>
      <h3 className="text-title-sm font-medium">
        <Trans>Your phone</Trans>
      </h3>
      {state.status === "signed_out" ? (
        <p className="text-body-sm text-muted-foreground">
          <Trans>Sign in to Gente to pair your phone.</Trans>
        </p>
      ) : null}
      {state.status === "off" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body-sm text-muted-foreground">
            <Trans>
              Use Gente on your phone. Chats and tasks run on this computer, sealed end to end.
            </Trans>
          </p>
          <Button size="sm" disabled={busy} onClick={() => act(gente.linkStart)}>
            <Trans>Pair a phone</Trans>
          </Button>
        </div>
      ) : null}
      {state.status === "waiting" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body-sm text-muted-foreground">
            <Trans>Open Gente on your phone and scan this code.</Trans>
          </p>
          {state.qrImage ? (
            <img
              src={state.qrImage}
              alt=""
              width={220}
              height={220}
              className="rounded-md border border-border bg-white p-2"
            />
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(gente.linkUnpair)}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      ) : null}
      {state.status === "paired" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body">
            {phoneName ? (
              <Trans>Paired with {phoneName}</Trans>
            ) : (
              <Trans>Paired with your phone</Trans>
            )}
          </p>
          {code ? (
            <p className="text-body-sm text-muted-foreground">
              <Trans>
                Safety code <span className="font-mono text-foreground">{code}</span>. Your phone
                shows the same code.
              </Trans>
            </p>
          ) : null}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => act(gente.linkUnpair)}>
            <Trans>Unpair</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans } from "@lingui/react/macro";
import type { GenteAccountState } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { desktopBridge } from "../platform/desktop";

/** Settings → Plan: the plan from Gente Cloud, free messages or hours left, and sign-in. */
export function GentePlanControl() {
  const gente = desktopBridge()?.gente;
  const [state, setState] = useState<GenteAccountState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!gente) return;
    let alive = true;
    void gente.account().then((next) => alive && setState(next)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gente]);
  if (!gente) return <span className="text-body-sm text-muted-foreground"><Trans>Free</Trans></span>;
  if (!state?.signedIn)
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void gente
            .signIn()
            .then(setState)
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        <Trans>Sign in</Trans>
      </Button>
    );
  const detail =
    state.monthlyHours && state.hoursLeft !== null ? (
      <Trans>
        {state.hoursLeft} of {state.monthlyHours} hours left
      </Trans>
    ) : state.messagesLimit !== null && state.messagesUsed !== null ? (
      <Trans>
        {Math.max(0, state.messagesLimit - state.messagesUsed)} of {state.messagesLimit} free messages left
      </Trans>
    ) : null;
  return (
    <span className="text-body-sm text-muted-foreground" data-testid="gente-plan">
      {state.plan ?? <Trans>Unknown</Trans>}
      {detail ? <> · {detail}</> : null}
    </span>
  );
}

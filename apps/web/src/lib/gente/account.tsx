// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans } from "@lingui/react/macro";
import type { GenteAccountState } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { desktopBridge } from "../platform/desktop";
import { useSave } from "../query/query";

/** Settings → Plan: the plan from Gente Cloud, free messages or hours left, and sign-in. */
export function GentePlanControl() {
  const gente = desktopBridge()?.gente;
  const [state, setState] = useState<GenteAccountState | null>(null);
  const signIn = useSave({
    save: async () => (gente ? gente.signIn() : null),
    onSaved: (next) => next && setState(next),
  });
  useEffect(() => {
    if (!gente) return;
    let alive = true;
    void gente
      .account()
      .then((next) => alive && setState(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gente]);
  if (!gente)
    return (
      <span className="text-body-sm text-muted-foreground">
        <Trans>Free</Trans>
      </span>
    );
  if (!state?.signedIn)
    return (
      <Button variant="outline" size="sm" disabled={signIn.pending} onClick={() => signIn.run()}>
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
        {Math.max(0, state.messagesLimit - state.messagesUsed)} of {state.messagesLimit} free
        messages left
      </Trans>
    ) : null;
  return (
    <span className="flex flex-col items-end text-body-sm" data-testid="gente-plan">
      <span>{state.plan ?? <Trans>Unknown</Trans>}</span>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

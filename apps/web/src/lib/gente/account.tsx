// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans } from "@lingui/react/macro";
import type { GenteAccountState, GenteAiMode } from "@rakazo/contracts";
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

/**
 * Settings → Where the AI runs. Fast answers on Gente's servers (paid plans); Private keeps the
 * AI on this computer. The tradeoff is said plainly, and switching back is one click.
 */
export function GenteAiModeControl() {
  const gente = desktopBridge()?.gente;
  const [state, setState] = useState<GenteAiMode | null>(null);
  useEffect(() => {
    if (!gente) return;
    let alive = true;
    void gente.aiMode().then((next) => alive && setState(next)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gente]);
  if (!gente || !state) return null;
  const pick = (mode: "fast" | "private") => void gente.setAiMode(mode).then(setState).catch(() => undefined);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1" role="radiogroup" aria-label="Where the AI runs">
        <Button
          variant={state.mode === "fast" ? "default" : "outline"}
          size="sm"
          role="radio"
          aria-checked={state.mode === "fast"}
          disabled={!state.fastAvailable}
          onClick={() => pick("fast")}
        >
          <Trans>Fast</Trans>
        </Button>
        <Button
          variant={state.mode === "private" ? "default" : "outline"}
          size="sm"
          role="radio"
          aria-checked={state.mode === "private"}
          onClick={() => pick("private")}
        >
          <Trans>Private</Trans>
        </Button>
      </div>
      <span className="max-w-[36ch] text-right text-body-sm text-muted-foreground">
        {state.mode === "fast" ? (
          <Trans>Fast mode sends your messages to our servers to answer quickly. We don't store or train on them.</Trans>
        ) : state.fastAvailable ? (
          <Trans>Private: the AI runs on this computer. Slower, and nothing leaves it.</Trans>
        ) : (
          <Trans>Private: the AI runs on this computer. Fast mode comes with a paid plan.</Trans>
        )}
      </span>
    </div>
  );
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans } from "@lingui/react/macro";
import type { GenteAccountState, GenteAiMode, GentePrivateOffer } from "@rakazo/contracts";
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
        disabled={signIn.pending}
        onClick={() => signIn.run()}
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
    <span className="flex flex-col items-end text-body-sm" data-testid="gente-plan">
      <span>{state.plan ?? <Trans>Unknown</Trans>}</span>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
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

/** "Make my AI private": a waitlist for now, with the price and how many are waiting. */
export function GentePrivateWaitlist() {
  const gente = desktopBridge()?.gente;
  const [offer, setOffer] = useState<GentePrivateOffer | null>(null);
  const waitlist = useSave({
    save: async (join: boolean) => (gente ? gente.setPrivateWaitlist(join) : null),
    onSaved: (next) => next && setOffer(next),
  });
  useEffect(() => {
    if (!gente?.privateOffer) return;
    let alive = true;
    void gente.privateOffer().then((next) => alive && setOffer(next)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gente]);
  if (!gente || !offer) return null;
  const price = (offer.monthlyCents / 100).toFixed(2);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={waitlist.pending}
        aria-pressed={offer.onWaitlist}
        onClick={() => waitlist.run(!offer.onWaitlist)}
      >
        {offer.onWaitlist ? <Trans>You're on the waitlist</Trans> : <Trans>Join the waitlist</Trans>}
      </Button>
      <span className="text-body-sm">
        <Trans>${price}/mo</Trans>
      </span>
      <span className="text-body-sm text-muted-foreground">
        <Trans>{offer.waiting} waiting</Trans>
      </span>
    </div>
  );
}

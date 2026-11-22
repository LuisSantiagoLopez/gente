// Modified by DeskHead Inc. in 2026 for Gente (fork of Rakazo, Apache-2.0).
// Gente: one "Update to vX.Y.Z" button. A click checks, downloads (with progress), verifies,
// installs and relaunches. A failure shows one plain sentence and "Try again". A Mac app run from
// a DMG or Downloads gets one "Move to Applications" button first.
import { Trans, useLingui } from "@lingui/react/macro";
import { useTimeout } from "@rakazo/chat-ui/hooks";
import type { DesktopUpdateState } from "@rakazo/contracts";
import { Button, SectionHeading } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/platform/desktop";

type Action = "check" | "update" | "move";

function useDesktopUpdates() {
  const { t } = useLingui();
  const bridge = desktopBridge()?.update;
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedCheck, setConfirmedCheck] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const revision = useRef(0);

  // Each finished read schedules the next one: every half second while an update runs (so the
  // progress moves), otherwise every two seconds.
  const [nextRefresh, setNextRefresh] = useState<object | null>(null);
  async function refresh() {
    if (!bridge) return;
    const started = revision.current;
    try {
      const next = await bridge.state();
      if (started === revision.current) {
        setState((current) =>
          current &&
          Object.entries(next).every(
            ([key, value]) => current[key as keyof DesktopUpdateState] === value,
          )
            ? current
            : next,
        );
      }
    } catch {
      // A disappearing bridge during shutdown should not interrupt the app.
    } finally {
      setNextRefresh({});
    }
  }
  useEffect(() => {
    void refresh();
  }, [bridge]);
  useTimeout(
    () => void refresh(),
    bridge && nextRefresh ? (busy ? 500 : 2_000) : null,
    nextRefresh,
  );

  async function act(action: Action) {
    if (!bridge || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    if (action === "check") setConfirmedCheck(null);
    try {
      const next =
        action === "check"
          ? await bridge.check()
          : action === "move"
            ? await (bridge.moveToApplications ?? bridge.state)()
            : await (bridge.updateNow ?? bridge.install)();
      revision.current++;
      setState(next);
      if (
        action === "check" &&
        next.phase === "idle" &&
        !next.message &&
        next.checkedAt !== state?.checkedAt
      ) {
        setConfirmedCheck(next.checkedAt);
      }
      if (next.phase === "error" || (action === "update" && next.message)) {
        setError(next.message ?? t`The update did not finish. Your current version is still here.`);
      }
    } catch {
      setError(t`The update did not finish. Your current version is still here.`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { state, busy, error, act, confirmedCheck };
}

const UpdatesContext = createContext<ReturnType<typeof useDesktopUpdates> | null>(null);

export function DesktopUpdatesProvider({ children }: { children: ReactNode }) {
  const updates = useDesktopUpdates();
  return <UpdatesContext.Provider value={updates}>{children}</UpdatesContext.Provider>;
}

/** What the Update button should say and do right now. Null when there is nothing to offer. */
export function updateOffer(state: DesktopUpdateState | null, busy: boolean, error: string | null) {
  if (!state) return null;
  if (state.fix === "move-to-applications") {
    return { kind: "move" as const, version: null, percent: null, message: state.message };
  }
  const version = state.availableVersion;
  if (version === null) return null;
  const running = busy || state.phase === "downloading" || state.phase === "checking";
  if (running) {
    return { kind: "running" as const, version, percent: state.percent, message: null };
  }
  if (state.phase === "error" || error) {
    return { kind: "retry" as const, version, percent: null, message: error ?? state.message };
  }
  if (state.phase === "available" || state.phase === "ready") {
    return { kind: "update" as const, version, percent: null, message: null };
  }
  return null;
}

export function useSidebarUpdate() {
  const updates = useContext(UpdatesContext);
  const offer = updates ? updateOffer(updates.state, updates.busy, updates.error) : null;
  return {
    offer,
    run: () => void updates?.act(offer?.kind === "move" ? "move" : "update"),
  };
}

/** The button's label, shared by the sidebar and Settings. */
export function UpdateLabel({ offer }: { offer: NonNullable<ReturnType<typeof updateOffer>> }) {
  if (offer.kind === "move") return <Trans>Move to Applications</Trans>;
  if (offer.kind === "retry") return <Trans>Try again</Trans>;
  if (offer.kind === "running") {
    return offer.percent === null ? (
      <Trans>Updating…</Trans>
    ) : (
      <Trans>Updating… {offer.percent}%</Trans>
    );
  }
  return <Trans>Update to v{offer.version}</Trans>;
}

export function DesktopUpdateSection() {
  const updates = useContext(UpdatesContext);
  if (!updates?.state) return null;
  const { state, busy, error, act, confirmedCheck } = updates;
  const offer = updateOffer(state, busy, error);
  return (
    <section
      data-testid="desktop-update-settings"
      className="mt-5 rounded-xl border border-border px-4 py-4"
    >
      <SectionHeading variant="heading">
        <Trans>Desktop app</Trans>
      </SectionHeading>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-body text-muted-foreground">v{state.currentVersion}</span>
        {offer ? (
          <Button
            disabled={offer.kind === "running"}
            onClick={() => void act(offer.kind === "move" ? "move" : "update")}
          >
            <UpdateLabel offer={offer} />
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy || state.phase === "checking"}
            onClick={() => void act("check")}
          >
            {busy || state.phase === "checking" ? (
              <Trans>Checking…</Trans>
            ) : (
              <Trans>Check for updates</Trans>
            )}
          </Button>
        )}
      </div>
      <p role="status" className="mt-2 text-body text-muted-foreground">
        {offer?.message ??
          error ??
          state.message ??
          (state.phase === "idle" && confirmedCheck && state.checkedAt === confirmedCheck ? (
            <Trans>Up to date</Trans>
          ) : null)}
      </p>
    </section>
  );
}

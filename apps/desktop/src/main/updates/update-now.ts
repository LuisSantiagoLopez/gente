// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The one Update button: whatever state the updater is in, take the next steps in order.
//   idle / error  -> check (a "Try again" after a failure starts here)
//   available     -> download with progress, then verify
//   ready         -> install and relaunch
// Any step that does not reach the next state stops here, and the old version keeps running.
import type { DesktopUpdateState } from "@rakazo/contracts";

export interface UpdateSteps {
  state: () => DesktopUpdateState;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  install: () => Promise<DesktopUpdateState>;
}

export async function updateNow(steps: UpdateSteps): Promise<DesktopUpdateState> {
  let state = steps.state();
  if (state.phase === "idle" || state.phase === "error" || state.phase === "unsupported") {
    state = await steps.check();
  }
  if (state.phase === "available") state = await steps.download();
  // A download that is already running finishes before installing.
  if (state.phase === "downloading") state = await steps.download();
  if (state.phase !== "ready") return state;
  return steps.install();
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// The "Cloud GPU" switch beside Send, and the one status line above the chat box: "Starting cloud
// GPU… 2.1 s", then "Cloud GPU · H100", gone once the GPU is stopped, plus the plain privacy note
// while it is on. Shown only in the desktop app on a Mac that has a Cloud GPU key.
// Who calls it: apps/web/src/pages/Shell.tsx. State: lib/cloud-gpu/use-cloud-gpu.ts.
import { Switch } from "@rakazo/ui-web";
import { CLOUD_PRIVACY_NOTE, cloudGpuLine } from "../../../lib/cloud-gpu/cloud-gpu-status";
import type { useCloudGpu } from "../../../lib/cloud-gpu/use-cloud-gpu";

type CloudGpu = ReturnType<typeof useCloudGpu>;

export function CloudGpuSwitch({ cloud }: { cloud: CloudGpu }) {
  if (!cloud.state?.available) return null;
  return (
    <span
      className="pointer-events-auto flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground"
      title={cloud.state.on ? CLOUD_PRIVACY_NOTE : "Use a fast rented GPU for this chat"}
    >
      <Switch
        id="cloud-gpu-switch"
        size="sm"
        checked={cloud.state.on}
        onCheckedChange={(on: boolean) => void cloud.setOn(on)}
        aria-label="Cloud GPU"
        data-testid="cloud-gpu-switch"
      />
      <label htmlFor="cloud-gpu-switch" className="cursor-pointer">
        Cloud GPU
      </label>
    </span>
  );
}

export function CloudGpuStatusLine({ cloud }: { cloud: CloudGpu }) {
  if (!cloud.state?.available) return null;
  const line = cloudGpuLine(cloud.state, cloud.now);
  if (!cloud.state.on && !line) return null;
  const tone =
    line?.tone === "warn"
      ? "text-destructive"
      : line?.tone === "busy"
        ? "text-foreground"
        : "text-muted-foreground";
  return (
    <div
      className="pointer-events-auto bg-background px-6 pb-1 text-center text-body-sm"
      data-testid="cloud-gpu-status"
      aria-live="polite"
    >
      {line ? <span className={`tabular-nums ${tone}`}>{line.text}</span> : null}
      {line && cloud.state.on ? <span className="text-muted-foreground"> · </span> : null}
      {cloud.state.on ? <span className="text-muted-foreground">{CLOUD_PRIVACY_NOTE}</span> : null}
    </div>
  );
}

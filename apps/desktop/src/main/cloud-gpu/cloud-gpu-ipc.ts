// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Puts Cloud GPU together for the app: the sessions, the switch, the route the model router
// uses, and the three calls the chat page makes (state, switch, prewarm). Who calls it: main.ts,
// once at launch, before the model router starts; main.ts also calls `shutdown` on quit.
import { handleIpc } from "../ipc/ipc.js";
import { CLOUD_GPU_CONTROL_URL, readCloudGpuKey } from "./cloud-gpu-config.js";
import { meterFile } from "./cloud-gpu-meter.js";
import type { CloudRoute } from "./cloud-gpu-route.js";
import { createCloudRoute } from "./cloud-gpu-route.js";
import { createCloudGpuSessions } from "./cloud-gpu-sessions.js";
import { createCloudGpuToggle } from "./cloud-gpu-toggle.js";
import { createVisionRelay, localDescriber } from "./cloud-gpu-vision.js";

export function setUpCloudGpu(input: {
  userDataDir: string;
  stackDir: string;
  /** This Mac's model server, which describes pictures for the GPU model. */
  localBase?: string;
}): {
  route: CloudRoute;
  shutdown: () => Promise<void>;
} {
  const sessions = createCloudGpuSessions({
    controlUrl: CLOUD_GPU_CONTROL_URL,
    key: () => readCloudGpuKey(),
  });
  const toggle = createCloudGpuToggle({
    userDataDir: input.userDataDir,
    stackDir: input.stackDir,
    sessions,
    hasKey: async () => Boolean(await readCloudGpuKey()),
  });
  void toggle.init();
  handleIpc("desktop.gente.cloudGpu", () => toggle.state());
  handleIpc("desktop.gente.setCloudGpu", (_event, on: unknown) => toggle.set(on));
  handleIpc("desktop.gente.prewarmCloudGpu", () => toggle.prewarm());
  const route = createCloudRoute({
    sessions,
    active: () => toggle.active(),
    fellBack: (message) => toggle.fellBack(message),
    recovered: () => toggle.recovered(),
    meter: meterFile(input.stackDir),
    ...(input.localBase
      ? { describeImages: createVisionRelay(localDescriber(input.localBase)) }
      : {}),
  });
  return { route, shutdown: () => toggle.shutdown() };
}

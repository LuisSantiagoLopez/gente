// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Puts Cloud GPU together for the app: the sessions, the switch, the route the model router
// uses, and the three calls the chat page makes (state, switch, prewarm). Who calls it: main.ts,
// once at launch, before the model router starts; main.ts also calls `shutdown` on quit.
import { handleIpc } from "../ipc/ipc.js";
import {
  CLOUD_GPU_CONTROL_URL,
  CLOUD_GPU_SHARED_URL,
  readCloudGpuKey,
} from "./cloud-gpu-config.js";
import type { CloudRoute } from "./cloud-gpu-route.js";
import { createCloudRoute } from "./cloud-gpu-route.js";
import { createCloudGpuSessions } from "./cloud-gpu-sessions.js";
import { createSharedGpu } from "./cloud-gpu-shared.js";
import { createCloudGpuToggle } from "./cloud-gpu-toggle.js";
import { createWarmPool } from "./cloud-gpu-warm.js";

export function setUpCloudGpu(input: { userDataDir: string; stackDir: string }): {
  route: CloudRoute;
  shutdown: () => Promise<void>;
} {
  const sessions = createCloudGpuSessions({
    controlUrl: CLOUD_GPU_CONTROL_URL,
    key: () => readCloudGpuKey(),
  });
  const shared = createSharedGpu({ url: CLOUD_GPU_SHARED_URL });
  let toggleMode: () => "shared" | "dedicated" = () => "shared";
  const warm = createWarmPool({
    controlUrl: CLOUD_GPU_CONTROL_URL,
    key: () => readCloudGpuKey(),
    mode: () => toggleMode(),
  });
  setInterval(() => void warm.tick(), 60_000).unref();
  const toggle = createCloudGpuToggle({
    warm,
    shared,
    userDataDir: input.userDataDir,
    stackDir: input.stackDir,
    sessions,
    hasKey: async () => Boolean(await readCloudGpuKey()),
  });
  toggleMode = () => toggle.mode();
  void toggle.init();
  handleIpc("desktop.gente.cloudGpu", () => toggle.state());
  handleIpc("desktop.gente.setCloudGpu", (_event, on: unknown) => toggle.set(on));
  handleIpc("desktop.gente.prewarmCloudGpu", () => toggle.prewarm());
  handleIpc("desktop.gente.setCloudGpuMode", (_event, mode: unknown) => toggle.setMode(mode));
  const route = createCloudRoute({
    sessions,
    shared,
    mode: () => toggle.mode(),
    active: () => toggle.active(),
    fellBack: (message) => toggle.fellBack(message),
    recovered: () => toggle.recovered(),
    activity: () => warm.activity(),
  });
  return { route, shutdown: () => toggle.shutdown() };
}

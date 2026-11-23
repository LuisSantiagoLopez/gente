// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente.
//
// Where the Cloud GPU lives and how to reach it: the control address on Modal, the key in the
// macOS Keychain (account "gente", service "modal-gpu"), the larger cloud context window and the
// hourly price used for the cost line. Who calls it: cloud-gpu-sessions.ts and cloud-gpu-toggle.ts.
// The Modal side is infra/cloud-gpu/modal_app.py.
import { execFile } from "node:child_process";

/** The deployed control endpoint (`control` in infra/cloud-gpu/modal_app.py). */
export const CLOUD_GPU_CONTROL_URL =
  process.env.GENTE_CLOUD_GPU_URL?.trim() ||
  "https://luis-santiago-l-sanchez--yourai-cloud-gpu-control.us-east.modal.run";

/** The model name vLLM serves on the GPU. */
export const CLOUD_MODEL = "yourai-cloud";

/** The rented GPU is not limited by this Mac's memory, so runs get a far larger window. */
export const CLOUD_LIMITS = { contextWindow: 131_072, maxTokens: 32_768 } as const;

/** Modal's on-demand price per GPU hour (modal billing rates, 2026-11-22). */
export const GPU_DOLLARS_PER_HOUR: Record<string, number> = {
  H100: 3.95,
  H200: 4.54,
  B200: 6.25,
  L40S: 1.95,
};

export const KEYCHAIN = { account: "gente", service: "modal-gpu" } as const;

/** The endpoint key, read from the Keychain when needed and never written anywhere else. */
export function readCloudGpuKey(platform = process.platform): Promise<string | undefined> {
  if (process.env.GENTE_CLOUD_GPU_KEY) return Promise.resolve(process.env.GENTE_CLOUD_GPU_KEY);
  if (platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", KEYCHAIN.account, "-s", KEYCHAIN.service, "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}

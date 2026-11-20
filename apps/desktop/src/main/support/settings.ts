// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Support settings, kept in one small file in the app's data folder. Error reports default to
// "ask": nothing is sent until the person says yes, once or always.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ShareChoice = "ask" | "always" | "never";
export type UpdateChannel = "latest" | "canary";

export type SupportSettings = {
  shareDiagnostics: ShareChoice;
  /** "canary" gets fixes first; most people stay on "latest". */
  updateChannel: UpdateChannel;
};

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  shareDiagnostics: "ask",
  updateChannel: "latest",
};

const FILE = "support-settings.json";

export async function readSupportSettings(userDataDir: string): Promise<SupportSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(userDataDir, FILE), "utf8"),
    ) as Partial<SupportSettings>;
    return {
      shareDiagnostics: ["ask", "always", "never"].includes(parsed.shareDiagnostics as string)
        ? (parsed.shareDiagnostics as ShareChoice)
        : "ask",
      updateChannel: parsed.updateChannel === "canary" ? "canary" : "latest",
    };
  } catch {
    return DEFAULT_SUPPORT_SETTINGS;
  }
}

export async function writeSupportSettings(
  userDataDir: string,
  patch: Partial<SupportSettings>,
): Promise<SupportSettings> {
  const next = { ...(await readSupportSettings(userDataDir)), ...patch };
  await mkdir(userDataDir, { recursive: true });
  await writeFile(path.join(userDataDir, FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

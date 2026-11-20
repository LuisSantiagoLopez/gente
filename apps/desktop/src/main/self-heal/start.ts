// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Starts Gente's self-healing in the desktop app: the catalog's detectors on their clocks, the
// "Gente fixed itself" timeline (kept on this computer), and, only when the person turned on
// error reports with "Always send", one anonymous line per repair for the fleet.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { sendRepairEvent } from "../support/outbox.js";
import { readSupportSettings } from "../support/settings.js";
import type { HealEnv } from "./catalog.js";
import { CATALOG } from "./catalog.js";
import type { RouterHandle } from "./desktop-env.js";
import { desktopHealEnv } from "./desktop-env.js";
import type { HealEvent, Lang } from "./engine.js";
import { describe, HealEngine } from "./engine.js";

let engine: HealEngine<HealEnv> | null = null;
let timelineFile = "";

export function startSelfHeal(input: {
  userDataDir: string;
  stackDir: string;
  router: () => RouterHandle | null;
  mode: () => "fast" | "private";
  onEvent?: (event: HealEvent) => void;
}) {
  timelineFile = path.join(input.userDataDir, "self-heal-timeline.jsonl");
  const fleet = async (event: HealEvent | { failureId: string; outcome: "reported" }) => {
    const settings = await readSupportSettings(input.userDataDir);
    if (settings.shareDiagnostics !== "always") return;
    const idFile = path.join(input.userDataDir, "support-install-id");
    const installId = (await readFile(idFile, "utf8").catch(() => "")).trim() || randomUUID();
    await writeFile(idFile, installId).catch(() => undefined);
    await sendRepairEvent({
      version: app.getVersion(),
      platform: process.platform,
      installId,
      failureId: event.failureId,
      outcome: event.outcome,
      fixedBy: "fixedBy" in event ? event.fixedBy : undefined,
      ms: "ms" in event ? event.ms : undefined,
    });
  };
  engine = new HealEngine<HealEnv>({
    env: desktopHealEnv({
      stackDir: input.stackDir,
      router: input.router,
      mode: input.mode,
      notify: (failureId) => fleet({ failureId, outcome: "reported" }),
    }),
    specs: CATALOG,
    onEvent: (event) => {
      void mkdir(input.userDataDir, { recursive: true })
        .then(() => appendFile(timelineFile, `${JSON.stringify(event)}\n`))
        .catch(() => undefined);
      void fleet(event).catch(() => undefined);
      input.onEvent?.(event);
    },
  });
  return engine.start();
}

/** The "Gente fixed itself" timeline, newest first, in plain words. */
export async function selfHealTimeline(
  lang: Lang,
  limit = 30,
): Promise<{ at: string; text: string; outcome: string; detail?: string }[]> {
  const lines = (await readFile(timelineFile, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as HealEvent;
        const text = describe(event, CATALOG, lang);
        return text
          ? [
              {
                at: event.at,
                text,
                outcome: event.outcome,
                ...(event.tried.length > 1 ? { detail: event.tried.join(" → ") } : {}),
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
}

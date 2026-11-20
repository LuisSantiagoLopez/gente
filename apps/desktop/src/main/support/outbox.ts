// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The only two things support ever sends, and only after the person said yes:
//   - a ticket to a person (the support form's own endpoint), and
//   - a redacted diagnostics bundle (when error reports are on).
// Plus, with the same yes, anonymous health counts (launches, crashes, finished setups) that the
// staged rollout reads. None carries chat content.
import type { DiagnosticsBundle } from "./diagnostics.js";

/** `GENTE_SUPPORT_BASE` points tests at a stand-in server. */
export const SUPPORT_BASE = process.env.GENTE_SUPPORT_BASE?.trim() || "https://trytabmate.com";
/**
 * Gente Cloud's self-heal intake (cloud/supabase/functions/gente-selfheal on the cloud branch).
 * Set at build time from GENTE_SELFHEAL_URL; a build without it sends no reports.
 */
export const SELFHEAL_URL = process.env.GENTE_SELFHEAL_URL?.trim() ?? "";

export type Ticket = { email: string; name?: string; message: string };

async function post(pathname: string, body: unknown, fetcher: typeof fetch, base = SUPPORT_BASE) {
  if (base === "") return false;
  const res = await fetcher(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

/** Sends a ticket through the existing support form endpoint (it saves to the support table). */
export async function sendTicket(ticket: Ticket, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    return await post(
      "/api/support",
      {
        name: ticket.name ?? "",
        email: ticket.email,
        message: ticket.message.slice(0, 5000),
        website: "",
      },
      fetcher,
    );
  } catch {
    return false;
  }
}

export async function sendDiagnostics(bundle: DiagnosticsBundle, fetcher: typeof fetch = fetch) {
  try {
    return await post("/diagnostics", { kind: "bundle", bundle }, fetcher, SELFHEAL_URL);
  } catch {
    return false;
  }
}

export type HealthEvent = "launch" | "crash" | "setup_ok" | "setup_fail";

export async function sendHealthEvent(
  event: {
    version: string;
    channel: string;
    platform: string;
    event: HealthEvent;
    installId: string;
  },
  fetcher: typeof fetch = fetch,
) {
  try {
    return await post("/diagnostics", { kind: "health", ...event }, fetcher, SELFHEAL_URL);
  } catch {
    return false;
  }
}

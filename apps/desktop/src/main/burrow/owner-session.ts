// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente: on this computer the app never asks for a password. The workspace has one account, and
// this process holds the stack token, so when the window has no sign-in it gets the owner's
// session from the local server before the page shows. The token never reaches the page.
import type { Session } from "electron";

export const DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";
const OWNER_SESSION_PATH = "/api/auth/desktop/owner-session";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Whether a page address is the sign-in or sign-up screen. */
export function isSignInPage(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path === "/sign-in" || path === "/sign-up" || path.startsWith("/sign-in/");
  } catch {
    return false;
  }
}

/** Signs the window's session in as the owner when it is not signed in. True when it did. */
export async function ensureOwnerSession(
  fetchWith: Fetch,
  webUrl: string,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  const origin = new URL(webUrl).origin;
  const current = await fetchWith(`${origin}/api/auth/get-session`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if ((current as { user?: unknown } | null)?.user) return false;
  const signed = await fetchWith(`${origin}${OWNER_SESSION_PATH}`, {
    method: "POST",
    headers: { [DESKTOP_STACK_TOKEN_HEADER]: token, origin, "content-type": "application/json" },
    body: "{}",
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return (signed as { signedIn?: boolean } | null)?.signedIn === true;
}

/** The same, through an Electron session, so the cookie lands in the window's own jar. */
export function ensureWindowOwnerSession(
  session: Session,
  webUrl: string,
  token: string | null | undefined,
) {
  return ensureOwnerSession((url, init) => session.fetch(url, init), webUrl, token);
}

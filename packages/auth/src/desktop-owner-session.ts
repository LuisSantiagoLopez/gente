// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente: on a person's own computer the app never shows a sign-in screen. The workspace has one
// account, and only the desktop app's main process holds the stack token, so a request carrying
// that token signs the window in as that account. The token never reaches a web page.
import { timingSafeEqual } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

export const DESKTOP_OWNER_SESSION_PATH = "/desktop/owner-session";
export const DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";

/** Constant-time comparison of the header against the stack token. */
export function desktopTokenMatches(sent: string | null | undefined, token: string): boolean {
  if (!sent || !token) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function desktopOwnerSession(input: {
  /** The desktop stack token; without one the endpoint does not exist. */
  token: string | undefined;
  /** The workspace's one account, or null before anyone signed up. */
  owner: () => Promise<{ id: string } | null>;
}): BetterAuthPlugin {
  const token = input.token;
  return {
    id: "gente-desktop-owner-session",
    endpoints: token
      ? {
          desktopOwnerSession: createAuthEndpoint(
            DESKTOP_OWNER_SESSION_PATH,
            { method: "POST" },
            async (ctx) => {
              if (!desktopTokenMatches(ctx.request?.headers.get(DESKTOP_STACK_TOKEN_HEADER), token))
                throw new APIError("UNAUTHORIZED");
              const owner = await input.owner();
              if (!owner) return ctx.json({ signedIn: false });
              const user = await ctx.context.internalAdapter.findUserById(owner.id);
              if (!user) return ctx.json({ signedIn: false });
              const session = await ctx.context.internalAdapter.createSession(user.id);
              await setSessionCookie(ctx, { session, user });
              return ctx.json({ signedIn: true });
            },
          ),
        }
      : {},
  };
}

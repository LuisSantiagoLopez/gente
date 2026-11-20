// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The person's Gente account: Clerk sign-in in the system browser, and the Gente Cloud client that
// uses it. Local chat never needs an account; plan, hours and cloud tools do.
import { app, Notification, shell } from "electron";
import { createClerkSession, clerkConfig } from "./clerk-auth.js";
import type { GenteAccountState } from "@rakazo/contracts";
import { createGenteCloud, type GenteCloud } from "./gente-cloud.js";

type Sealer = { seal(value: string): Buffer; unseal(sealed: Buffer): string };

let session: ReturnType<typeof createClerkSession> | null = null;
let cloud: GenteCloud | null = null;
let signedIn = false;
/** Whether the last plan seen from Gente Cloud includes cloud work (paid). */
let paidPlan = false;
let onChange: () => void = () => undefined;

export function initAccount(input: { sealer: Sealer | undefined; rebuildMenu: () => void }) {
  onChange = input.rebuildMenu;
  if (!input.sealer) return;
  session = createClerkSession({
    config: clerkConfig(),
    userDataDir: app.getPath("userData"),
    sealer: input.sealer,
  });
  cloud = createGenteCloud({ token: () => session?.accessToken() ?? Promise.resolve(null) });
  void session.signedIn().then((value) => {
    signedIn = value;
    onChange();
  });
}

export const accountCloud = () => cloud;
export const isSignedIn = () => signedIn;

export async function signInToGente(): Promise<void> {
  if (!session) return;
  try {
    await session.signIn((url) => shell.openExternal(url));
    signedIn = true;
    new Notification({ title: "Gente", body: "You're signed in." }).show();
  } catch {
    new Notification({ title: "Gente", body: "Sign-in didn't finish. Try again from the Gente menu." }).show();
  } finally {
    onChange();
  }
}

export async function signOutOfGente(): Promise<void> {
  await session?.signOut();
  signedIn = false;
  onChange();
}

const EMPTY: Omit<GenteAccountState, "signedIn"> = {
  plan: null,
  messagesUsed: null,
  messagesLimit: null,
  hoursLeft: null,
  monthlyHours: null,
};

/** What Settings shows. Offline or a cloud error keeps the values unknown, never zero. */
export async function accountState(): Promise<GenteAccountState> {
  if (!signedIn || !cloud) return { signedIn, ...EMPTY };
  try {
    const me = await cloud.me();
    paidPlan = (me.plan as { cloud?: boolean } | undefined)?.cloud === true;
    return {
      signedIn: true,
      plan: me.plan?.name ?? null,
      messagesUsed: me.plan?.messagesUsed ?? null,
      messagesLimit: me.plan?.messagesLimit ?? null,
      hoursLeft:
        typeof me.balance?.totalSeconds === "number" ? Math.floor(me.balance.totalSeconds / 360) / 10 : null,
      monthlyHours: me.plan?.monthlyOnlineHours ?? null,
    };
  } catch {
    return { signedIn: true, ...EMPTY };
  }
}

/**
 * Free plan: each message counts once at Gente Cloud (same id twice counts once). Signed out, or
 * offline, local chat keeps working: it costs nothing, and a network blip must never block it.
 */
export async function consumeFreeMessage(messageId: unknown): Promise<boolean> {
  if (typeof messageId !== "string" || !/^[\w-]{6,128}$/.test(messageId)) return true;
  if (!signedIn || !cloud) return true;
  try {
    return (await cloud.consumeMessage(messageId, "app")).allowed;
  } catch {
    return true;
  }
}

export const isPaidPlan = () => signedIn && paidPlan;

/** The person's own token for Gente Cloud, refreshed as needed; null when signed out. */
export const accountToken = () => session?.accessToken() ?? Promise.resolve(null);

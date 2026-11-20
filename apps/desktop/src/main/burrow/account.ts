// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The person's Gente account: Clerk sign-in in the system browser, and the Gente Cloud client that
// uses it. Local chat never needs an account; plan, hours and cloud tools do.
import { app, Notification, shell } from "electron";
import { createClerkSession, clerkConfig } from "./clerk-auth.js";
import { createGenteCloud, type GenteCloud } from "./gente-cloud.js";

type Sealer = { seal(value: string): Buffer; unseal(sealed: Buffer): string };

let session: ReturnType<typeof createClerkSession> | null = null;
let cloud: GenteCloud | null = null;
let signedIn = false;
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

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente account sign-in with Clerk, the desktop way: the system browser opens Clerk's own sign-in
// (Google, Apple, email code, MFA and bot protection all live there), and the app never shows a
// password field. OAuth 2.0 authorization code + PKCE (S256), public client, loopback redirect on
// 127.0.0.1 (RFC 8252). Tokens are sealed with the system keychain (Electron safeStorage).
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "../setup/setup-store.js";

export interface ClerkConfig {
  /** Clerk Frontend API origin, for example https://cool-airedale-3945.clerk.accounts.dev */
  issuer: string;
  /** The public OAuth application's client id (no secret: this is a desktop app). */
  clientId: string;
  scopes?: string;
}

/** The Clerk development instance Gente builds against until the production keys arrive. */
export const CLERK_DEV: ClerkConfig = {
  issuer: "https://cool-airedale-3945.clerk.accounts.dev",
  clientId: "bH7Gxkx092MeMhQ1",
};

export function clerkConfig(env: NodeJS.ProcessEnv = process.env): ClerkConfig {
  return {
    issuer: env.GENTE_CLERK_ISSUER?.trim() || CLERK_DEV.issuer,
    clientId: env.GENTE_CLERK_CLIENT_ID?.trim() || CLERK_DEV.clientId,
    scopes: "profile email offline_access",
  };
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
}

interface Sealer {
  seal(value: string): Buffer;
  unseal(sealed: Buffer): string;
}

type Fetch = typeof fetch;

const b64url = (buffer: Buffer) => buffer.toString("base64url");

export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function tokenRequest(config: ClerkConfig, body: Record<string, string>, doFetch: Fetch): Promise<Tokens> {
  const response = await doFetch(`${config.issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, ...body }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !data.access_token) throw new Error(`token request failed: ${data.error ?? response.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;background:#FBF6EC;color:#1C1710;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p>${line}</p></div></body>`;

/**
 * Opens Clerk's sign-in in the person's browser and waits for the redirect back to this computer.
 * `open` receives the authorize URL (Electron's shell.openExternal in the app).
 */
export async function signInWithBrowser(input: {
  config: ClerkConfig;
  open: (url: string) => Promise<void> | void;
  fetch?: Fetch;
  timeoutMs?: number;
}): Promise<Tokens> {
  const { config } = input;
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(16));
  let server: Server | undefined;
  try {
    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get("error");
        const got = url.searchParams.get("code");
        if (error || !got || url.searchParams.get("state") !== state) {
          response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          response.end(PAGE("Sign-in didn't finish", "Go back to Your AI and try again."));
          reject(new Error(`sign-in callback: ${error ?? "bad state or code"}`));
          return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(PAGE("You're signed in", "You can close this tab and go back to Your AI."));
        resolve({ code: got, redirectUri });
      });
      let redirectUri = "";
      server.once("error", reject);
      // Loopback only: nothing else on the network can deliver a code here.
      server.listen(0, "127.0.0.1", () => {
        const address = server!.address();
        const port = typeof address === "object" && address ? address.port : 0;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const authorize = new URL(`${config.issuer}/oauth/authorize`);
        authorize.search = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: redirectUri,
          scope: config.scopes ?? "profile email offline_access",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        Promise.resolve(input.open(authorize.toString())).catch(reject);
      });
      setTimeout(() => reject(new Error("sign-in timed out")), input.timeoutMs ?? 10 * 60_000).unref();
    });
    return await tokenRequest(
      config,
      { grant_type: "authorization_code", code: code.code, redirect_uri: code.redirectUri, code_verifier: verifier },
      input.fetch ?? fetch,
    );
  } finally {
    server?.close();
  }
}

/** Keeps the person signed in across launches, sealed by the system keychain. */
export function createClerkSession(input: {
  config: ClerkConfig;
  userDataDir: string;
  sealer: Sealer;
  fetch?: Fetch;
}) {
  const file = path.join(input.userDataDir, "gente-account.sealed");
  let tokens: Tokens | null | undefined;
  let refreshing: Promise<Tokens | null> | null = null;

  async function load(): Promise<Tokens | null> {
    if (tokens !== undefined) return tokens;
    try {
      tokens = JSON.parse(input.sealer.unseal(Buffer.from(await readFile(file, "utf8"), "base64"))) as Tokens;
    } catch {
      tokens = null;
    }
    return tokens;
  }

  async function save(next: Tokens | null) {
    tokens = next;
    if (next === null) await rm(file, { force: true });
    else await writePrivateFile(file, input.sealer.seal(JSON.stringify(next)).toString("base64"));
  }

  return {
    signedIn: async () => (await load()) !== null,
    async signIn(open: (url: string) => Promise<void> | void) {
      await save(await signInWithBrowser({ config: input.config, open, fetch: input.fetch }));
    },
    signOut: () => save(null),
    /** A current access token for Gente Cloud, refreshed a minute before it expires. */
    async accessToken(): Promise<string | null> {
      const current = await load();
      if (!current) return null;
      if (current.expiresAt - Date.now() > 60_000) return current.accessToken;
      if (!current.refreshToken) return null;
      refreshing ??= tokenRequest(
        input.config,
        { grant_type: "refresh_token", refresh_token: current.refreshToken },
        input.fetch ?? fetch,
      )
        .then(async (next) => {
          await save({ ...next, refreshToken: next.refreshToken ?? current.refreshToken });
          return next;
        })
        .catch(() => null)
        .finally(() => {
          refreshing = null;
        });
      return (await refreshing)?.accessToken ?? null;
    },
  };
}

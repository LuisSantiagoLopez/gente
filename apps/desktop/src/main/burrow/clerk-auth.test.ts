// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClerkSession, signInWithBrowser } from "./clerk-auth.js";

const config = { issuer: "https://idp.test", clientId: "client123" };
const sealer = {
  seal: (v: string) => Buffer.from(`sealed:${Buffer.from(v).toString("hex")}`),
  unseal: (b: Buffer) => Buffer.from(b.toString().slice(7), "hex").toString(),
};

/** Plays the browser: reads the authorize URL, then calls the loopback callback with a code. */
function browser(code = "code-1") {
  let authorize: URL | undefined;
  const open = async (url: string) => {
    authorize = new URL(url);
    const back = new URL(authorize.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", authorize.searchParams.get("state")!);
    await fetch(back);
  };
  return { open, authorize: () => authorize! };
}

describe("Your AI sign-in with Clerk (PKCE, loopback)", () => {
  it("sends a S256 challenge, returns to 127.0.0.1, and proves the verifier when trading the code", async () => {
    const b = browser();
    const tokenFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      const challenge = createHash("sha256").update(body.get("code_verifier")!).digest("base64url");
      expect(challenge).toBe(b.authorize().searchParams.get("code_challenge"));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe("client123");
      expect(body.has("client_secret")).toBe(false);
      return new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      );
    });
    const tokens = await signInWithBrowser({ config, open: b.open, fetch: tokenFetch as never });
    const a = b.authorize();
    expect(a.origin + a.pathname).toBe("https://idp.test/oauth/authorize");
    expect(a.searchParams.get("code_challenge_method")).toBe("S256");
    expect(a.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("refuses a callback with the wrong state", async () => {
    const open = async (url: string) => {
      const back = new URL(new URL(url).searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "x");
      back.searchParams.set("state", "forged");
      await fetch(back);
    };
    await expect(signInWithBrowser({ config, open, fetch: vi.fn() as never })).rejects.toThrow(
      /bad state/,
    );
  });

  it("keeps the session sealed on disk and refreshes it before it expires", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gente-account-"));
    try {
      let n = 0;
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: `at${++n}`,
              refresh_token: "rt",
              expires_in: n === 1 ? 30 : 3600,
            }),
          ),
      );
      const session = createClerkSession({
        config,
        userDataDir: dir,
        sealer,
        fetch: fetchMock as never,
      });
      await session.signIn(browser().open);
      const stored = await readFile(path.join(dir, "gente-account.sealed"), "utf8");
      expect(Buffer.from(stored, "base64").toString()).not.toContain("at1");
      // at1 expires in 30 s, inside the one-minute margin, so it is refreshed.
      expect(await session.accessToken()).toBe("at2");
      await session.signOut();
      expect(await session.accessToken()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

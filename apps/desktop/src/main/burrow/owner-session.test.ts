import { describe, expect, it, vi } from "vitest";
import { DESKTOP_STACK_TOKEN_HEADER, ensureOwnerSession, isSignInPage } from "./owner-session.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the owner's session on this computer", () => {
  it("signs the window in with the stack token when it has no session", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/get-session") ? json(null) : json({ signedIn: true }),
    );
    expect(await ensureOwnerSession(fetch, "http://127.0.0.1:45173/app", "tok")).toBe(true);
    const [url, init] = fetch.mock.calls[1]! as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:45173/api/auth/desktop/owner-session");
    expect((init.headers as Record<string, string>)[DESKTOP_STACK_TOKEN_HEADER]).toBe("tok");
  });

  it("leaves a signed-in window alone, and does nothing without a token", async () => {
    const fetch = vi.fn(async () => json({ user: { id: "u1" } }));
    expect(await ensureOwnerSession(fetch, "http://127.0.0.1:45173/", "tok")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const none = vi.fn();
    expect(await ensureOwnerSession(none, "http://127.0.0.1:45173/", null)).toBe(false);
    expect(none).not.toHaveBeenCalled();
  });

  it("knows the sign-in screens", () => {
    expect(isSignInPage("http://127.0.0.1:45173/sign-in")).toBe(true);
    expect(isSignInPage("http://127.0.0.1:45173/sign-up")).toBe(true);
    expect(isSignInPage("http://127.0.0.1:45173/app/abc")).toBe(false);
  });
});

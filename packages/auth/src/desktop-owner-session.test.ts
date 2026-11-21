import { describe, expect, it } from "vitest";
import { desktopOwnerSession, desktopTokenMatches } from "./desktop-owner-session.js";

describe("desktop owner session", () => {
  it("accepts only the exact stack token", () => {
    expect(desktopTokenMatches("abc123", "abc123")).toBe(true);
    expect(desktopTokenMatches("abc124", "abc123")).toBe(false);
    expect(desktopTokenMatches("abc", "abc123")).toBe(false);
    expect(desktopTokenMatches(null, "abc123")).toBe(false);
    expect(desktopTokenMatches("", "")).toBe(false);
  });

  it("has no endpoint without a stack token", () => {
    const owner = async () => ({ id: "u1" });
    expect(Object.keys(desktopOwnerSession({ token: undefined, owner }).endpoints ?? {})).toEqual(
      [],
    );
    expect(Object.keys(desktopOwnerSession({ token: "t", owner }).endpoints ?? {})).toEqual([
      "desktopOwnerSession",
    ]);
  });
});

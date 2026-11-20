// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import { CloudError, createGenteCloud } from "./gente-cloud.js";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 304 ? null : JSON.stringify(body), { status, headers });

describe("Gente Cloud client", () => {
  it("sends the session token and reuses the plan on 304 (ETag)", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { plan: "pro", planVersion: 3 }, { etag: '"v3"' }))
      .mockResolvedValueOnce(json(304, null));
    const cloud = createGenteCloud({ token: async () => "tok", fetch, baseUrl: "https://c.test" });
    expect(await cloud.plan()).toEqual({ plan: { plan: "pro", planVersion: 3 }, changed: true });
    expect(await cloud.plan()).toEqual({ plan: { plan: "pro", planVersion: 3 }, changed: false });
    const second = fetch.mock.calls[1]!;
    expect(second[0]).toBe("https://c.test/v1/me/plan");
    expect(second[1].headers).toMatchObject({ authorization: "Bearer tok", "if-none-match": '"v3"' });
  });

  it("asks to sign in before any call when there is no session", async () => {
    const fetch = vi.fn();
    const cloud = createGenteCloud({ token: async () => null, fetch });
    await expect(cloud.balance()).rejects.toMatchObject({ code: "missing_token" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports out of hours as a known error and free messages as allowed or not", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(402, { error: "out_of_credit", message: "No hours left" }))
      .mockResolvedValueOnce(json(200, { allowed: true }))
      .mockResolvedValueOnce(json(402, { allowed: false, used: 10, limit: 10 }));
    const cloud = createGenteCloud({ token: async () => "t", fetch });
    const error = await cloud.startSession({ vendor: "e2b" }).catch((e) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect(error.code).toBe("out_of_credit");
    expect(await cloud.consumeMessage("m1", "app")).toEqual({ allowed: true });
    expect(await cloud.consumeMessage("m2", "app")).toEqual({ allowed: false });
  });

  it("turns a network failure into a calm offline error", async () => {
    const cloud = createGenteCloud({ token: async () => "t", fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    await expect(cloud.balance()).rejects.toMatchObject({ code: "offline" });
  });
});

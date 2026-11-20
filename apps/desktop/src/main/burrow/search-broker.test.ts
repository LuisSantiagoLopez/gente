// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it, vi } from "vitest";
import { startSearchBroker } from "./search-broker.js";

describe("search broker", () => {
  it("forwards a search only with its token, only when signed in, on loopback", async () => {
    const search = vi.fn(async () => ({ results: [{ title: "T", url: "https://a.test", text: "x" }] }));
    let signedIn = false;
    const broker = await startSearchBroker(() => ({ search }) as never, () => signedIn);
    try {
      expect(broker.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/search$/);
      const post = (token: string) =>
        fetch(broker.url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ query: "news today" }) });
      expect((await post("wrong")).status).toBe(404);
      expect((await post(broker.token)).status).toBe(404);
      signedIn = true;
      const ok = await post(broker.token);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ results: [{ title: "T", url: "https://a.test", text: "x" }] });
      expect(search).toHaveBeenCalledWith("news today", 4);
    } finally {
      await broker.close();
    }
  });
});

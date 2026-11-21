import { RESPONSE_STREAMING_STORAGE_KEY } from "@rakazo/core";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const stubStorage = (store: Map<string, string>) =>
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  });

describe("response streaming preference", () => {
  it("streams replies by default and saves a choice to turn it off", async () => {
    const store = new Map<string, string>();
    stubStorage(store);
    const { responseStreamingPreference, RESPONSE_STREAMING_KEY } = await import(
      "./response-streaming"
    );
    expect(responseStreamingPreference.get()).toBe(true);
    responseStreamingPreference.set(false);
    expect(store.get(RESPONSE_STREAMING_KEY)).toBe("off");
    responseStreamingPreference.set(true);
    expect(store.get(RESPONSE_STREAMING_KEY)).toBe("on");
  });

  it("ignores an 'off' saved under the old default", async () => {
    stubStorage(new Map([[RESPONSE_STREAMING_STORAGE_KEY, "off"]]));
    const { responseStreamingPreference } = await import("./response-streaming");
    expect(responseStreamingPreference.get()).toBe(true);
  });

  it("keeps a saved 'off'", async () => {
    const { RESPONSE_STREAMING_KEY } = await import("./response-streaming");
    vi.resetModules();
    stubStorage(new Map([[RESPONSE_STREAMING_KEY, "off"]]));
    const { responseStreamingPreference } = await import("./response-streaming");
    expect(responseStreamingPreference.get()).toBe(false);
  });
});

import { createStoredPreference } from "./stored-preference";

/**
 * Gente (modified from Rakazo): replies stream live unless the person turns it off. Rakazo left
 * streaming off until a saved "on", so new installs never saw a reply being written. A new key,
 * so an "off" saved by the old default does not carry over.
 */
export const RESPONSE_STREAMING_KEY = "gente.responseStreaming";

export const responseStreamingPreference = createStoredPreference({
  key: RESPONSE_STREAMING_KEY,
  parse: (raw) => raw?.trim().toLowerCase() !== "off",
  serialize: (enabled) => (enabled ? "on" : "off"),
});

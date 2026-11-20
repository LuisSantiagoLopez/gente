// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The outside services the desktop app wires its local server to, named in one place. Outside
// packages/adapters the desktop speaks of capabilities only ("connected apps", "cloud
// computers"); the provider ids, environment names and keychain names live here.

/** The capabilities the desktop holds a key for (developer builds only). */
export type ServiceKey = "connectedApps" | "cloudComputers";

/** Keychain service names (account "gente") that hold each key on a developer's Mac. */
export const KEYCHAIN_SERVICE: Record<ServiceKey, string> = {
  connectedApps: "COMPOSIO_API_KEY",
  cloudComputers: "E2B_API_KEY",
};

/** The server environment variables each key travels in; the desktop seals them at rest. */
export const SERVICE_KEY_ENV: Record<ServiceKey, string> = {
  connectedApps: "GENTE_COMPOSIO_KEY",
  cloudComputers: "E2B_API_KEY",
};

/** A key kept in the workspace's `.env` (sealed) from an earlier start. */
export function storedServiceKey(env: Map<string, string>, key: ServiceKey): string | undefined {
  return env.get(SERVICE_KEY_ENV[key]) || undefined;
}

/** Gente Cloud's connected-apps proxy, under the cloud's base URL. */
export const CONNECTED_APPS_CLOUD_PATH = "/v1/proxy/composio/mcp";
/** The connected-apps service itself, reached directly only with a developer key. */
export const CONNECTED_APPS_DIRECT_URL = "https://connect.composio.dev/mcp";
/** The header a developer key goes in when the relay reaches the service directly. */
export const CONNECTED_APPS_KEY_HEADER = "x-consumer-api-key";

/** How the server reaches connected apps: through the desktop's relay, or a developer key. */
export function connectedAppsEnv(input: {
  key?: string;
  relayUrl?: string | null;
}): Record<string, string> {
  return {
    ...(input.key ? { [SERVICE_KEY_ENV.connectedApps]: input.key } : {}),
    ...(input.relayUrl ? { GENTE_COMPOSIO_PROXY_URL: input.relayUrl } : {}),
  };
}

/** The computer Gente Cloud starts for a bot, billed while it runs. */
export const CLOUD_COMPUTER_SESSION = { vendor: "e2b", taskKind: "desktop" } as const;

/** Where bots' computers run: Gente's cloud (the default), or this computer. */
export type ComputerChoice = "cloud" | "local";

/**
 * The sandbox settings for the server. Cloud computers through Gente Cloud's broker when the
 * person's plan has online hours, or with a developer key; otherwise the platform's local choice
 * (VMs on a Mac, none on Windows). A task never waits for want of a computer.
 */
export function computerEnv(
  cloudKey: string | undefined,
  choice: ComputerChoice,
  localProvider: "local-vm" | "none",
  /** Gente Cloud's computer broker, when the person's plan includes online hours. */
  cloudBroker?: string | null,
): Record<string, string> {
  if (cloudBroker && choice === "cloud")
    return {
      SANDBOX_PROVIDER: "e2b",
      [SERVICE_KEY_ENV.cloudComputers]: "gente-cloud",
      GENTE_COMPUTER_BROKER_URL: cloudBroker,
    };
  if (cloudKey && choice === "cloud")
    return { SANDBOX_PROVIDER: "e2b", [SERVICE_KEY_ENV.cloudComputers]: cloudKey };
  return { SANDBOX_PROVIDER: localProvider };
}

/** Turns the server's error reporting and log shipping off: nothing leaves this computer. */
export const SERVER_TELEMETRY_OFF: Record<string, string> = {
  SENTRY_DSN: "",
  SENTRY_BROWSER_DSN: "",
  AXIOM_TOKEN: "",
  AXIOM_DATASET: "",
};

/** The server's log line when connected apps are not set up, which the self-healer watches for. */
export const CONNECTED_APPS_UNCONFIGURED =
  /composio\b[^\n]*not configured|missing_token[^\n]*connected apps/i;

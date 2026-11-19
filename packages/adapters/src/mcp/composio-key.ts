// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Composio Connect: one MCP endpoint that reaches every Composio app (search, connect through an
// OAuth link, execute). Gente's desktop app reads the consumer key from the OS keychain and hands
// it to the server processes as GENTE_COMPOSIO_KEY. It is added here, on the wire only, for that
// one host: never stored with the server, shown in the UI, put in a prompt or written to a log.

export const COMPOSIO_CONNECT_HOST = "connect.composio.dev";
export const COMPOSIO_CONNECT_URL = `https://${COMPOSIO_CONNECT_HOST}/mcp`;
const HEADER = "x-consumer-api-key";

export function withComposioKey(
  endpoint: string | URL,
  headers: Record<string, string> | undefined,
  key = process.env.GENTE_COMPOSIO_KEY?.trim(),
): Record<string, string> | undefined {
  if (!key) return headers;
  let url: URL;
  try {
    url = new URL(String(endpoint));
  } catch {
    return headers;
  }
  if (url.protocol !== "https:" || url.hostname !== COMPOSIO_CONNECT_HOST) return headers;
  if (headers && Object.keys(headers).some((name) => name.toLowerCase() === HEADER)) return headers;
  return { ...(headers ?? {}), [HEADER]: key };
}

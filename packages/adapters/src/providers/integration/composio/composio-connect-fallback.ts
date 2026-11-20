// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { isVitestRuntime } from "@rakazo/core/node/test-runtime";
import { ComposioConnectConnector } from "./composio-connect-connector.js";

/**
 * Gente's desktop app hands the server a Composio Connect consumer key from the OS keychain. With
 * it, and no project key, apps connect through Connect, so the in-chat card and Connections work.
 */
export function composioConnectFallback(
  key = process.env.GENTE_COMPOSIO_KEY?.trim(),
): ComposioConnectConnector | undefined {
  if (!key || isVitestRuntime()) return undefined;
  return new ComposioConnectConnector({ auth: { consumerKey: key } });
}

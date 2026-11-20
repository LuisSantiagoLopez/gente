// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * Many real API documents leave out operationId (Frankfurter, small vendors). Gente names such an
 * operation from its method and path, so a connector can still be built from the document:
 * `GET /v1/latest/{base}` becomes `get_v1_latest_base`.
 */
export function operationIdFor(method: string, path: string, given: unknown): string {
  if (typeof given === "string" && given.trim()) return given;
  const words = path
    .replace(/[{}]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return [method.toLowerCase(), ...words].join("_").slice(0, 120);
}

/**
 * A document without `servers` means its API sits at the document's own origin (OpenAPI's default
 * of "/"); many hosted specs rely on that.
 */
export function withDefaultServer<T extends Record<string, unknown>>(
  document: T,
  documentUrl: URL,
): T {
  const servers = document.servers;
  if (Array.isArray(servers) && servers.length > 0) return document;
  return { ...document, servers: [{ url: documentUrl.origin }] };
}

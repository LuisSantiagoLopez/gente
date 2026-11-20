// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Composio Connect has no directory call, so Gente lists the work apps from core. Their slugs are
// Composio toolkit slugs, checked against its tool search on 19 Nov 2026.
import { WORK_APPS } from "@rakazo/core";

export const COMPOSIO_CONNECT_APPS = WORK_APPS;

export function connectAppLogo(slug: string): string {
  return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;
}

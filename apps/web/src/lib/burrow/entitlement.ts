// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Burrow (a fork of Rakazo by Elie Steinbock).
//
// Burrow is a subscription to the app, not usage-based. Payments are not built yet; every
// plan check in the web app goes through this one function so licensing can replace the stub.

export type Entitlement = { plan: "free-trial" | "subscription"; active: boolean };

export function checkEntitlement(): Entitlement {
  return { plan: "free-trial", active: true };
}

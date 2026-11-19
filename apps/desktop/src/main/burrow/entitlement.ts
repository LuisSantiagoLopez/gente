// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente is sold as a subscription to the app, not by usage: the model runs on the
// person's own Mac. Payments are not built yet. Every plan check goes through
// `checkEntitlement`, so a license or subscription lookup can replace this stub later.

export type GentePlan = "free-trial" | "subscription";

export type Entitlement = {
  plan: GentePlan;
  /** False would block new bot runs once licensing exists. Always true in 0.1. */
  active: boolean;
  label: string;
};

export function checkEntitlement(): Entitlement {
  return { plan: "free-trial", active: true, label: "Free trial" };
}

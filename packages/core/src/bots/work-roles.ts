// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

/**
 * Onboarding asks "What do you do?"; each answer turns on the recipes that make that work pay.
 * Ordered by how many people do the work and how much of it an assistant can take.
 */
export const WORK_ROLES = [
  {
    id: "local-business",
    label: "Local business",
    recipes: ["booking-desk", "review-replies", "invoice-chaser"],
  },
  {
    id: "online-store",
    label: "Online store",
    recipes: ["store-support", "sales-digest", "listing-writer"],
  },
  {
    id: "freelancer",
    label: "Freelancer",
    recipes: ["proposal-writer", "invoice-chaser", "meeting-notes"],
  },
  { id: "sales", label: "Sales", recipes: ["deal-follow-up", "meeting-prep", "meeting-notes"] },
  {
    id: "real-estate",
    label: "Real estate",
    recipes: ["lead-responder", "meeting-notes", "review-replies"],
  },
  { id: "bookkeeper", label: "Bookkeeping", recipes: ["books-tidy", "invoice-chaser"] },
  {
    id: "consultant",
    label: "Consultant or agency",
    recipes: ["proposal-writer", "client-report", "meeting-notes"],
  },
  { id: "creator", label: "Creator", recipes: ["content-repurposer", "inbox-triage"] },
  { id: "marketer", label: "Marketing", recipes: ["client-report", "content-repurposer"] },
  { id: "recruiter", label: "Recruiting", recipes: ["candidate-outreach", "meeting-notes"] },
  { id: "developer", label: "Developer", recipes: ["pr-reviewer", "invoice-chaser"] },
  { id: "job-seeker", label: "Looking for work", recipes: ["job-hunt", "inbox-triage"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; recipes: readonly string[] }>;

export type WorkRoleId = (typeof WORK_ROLES)[number]["id"];

/** The recipes to turn on for the roles a person picked, each once, in role order. */
export function recipesForRoles(roles: readonly string[]): string[] {
  const picked = WORK_ROLES.filter((role) => roles.includes(role.id));
  return [...new Set(picked.flatMap((role) => role.recipes))];
}

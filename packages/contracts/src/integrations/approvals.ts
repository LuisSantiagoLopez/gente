import * as z from "zod";
import { Id } from "../ids.js";

export const ActionApprovalRuleSchema = z.object({
  id: Id,
  effect: z.enum(["always_allow", "require_approval", "deny"]),
  matchKind: z.enum(["tool", "connector", "category", "site"]),
  matchValue: z.string(),
  createdAt: z.string(),
});
export type ActionApprovalRule = z.infer<typeof ActionApprovalRuleSchema>;

/** How much a space asks before acting; see VISION.md. */
export const ApprovalModeSchema = z.enum(["never", "auto", "ask"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

/**
 * Four kinds of action always ask a person, in every approval mode including Never ask:
 * spending money, sending as the owner to other people, deleting the owner's data, and accepting
 * legal terms. These limits are the only way one passes by itself: a spend that keeps this task's
 * and this month's spending within the caps, a send or invite only to trusted contacts, or any
 * action in a trusted app (a spend there still has to fit the caps). Off unless the owner turns it
 * on, and never once outside content entered the run.
 */
export const AutoApproveLimitsSchema = z.object({
  enabled: z.boolean(),
  /** Most one task (run) may spend without asking, in the currency's minor unit; null: none. */
  perTaskMinor: z.number().int().min(0).max(1_000_000).nullable(),
  /** Most a calendar month may spend without asking, in minor units; null: none. */
  perMonthMinor: z.number().int().min(0).max(10_000_000).nullable(),
  currency: z.string().regex(/^[a-z]{3}$/),
  /** Email addresses a send or invite may go to without asking. */
  contacts: z.array(z.string().trim().toLowerCase().email().max(254)).max(50),
  /** Connected apps, by connector kind, whose actions pass without asking. */
  apps: z.array(z.string().trim().toLowerCase().min(1).max(64)).max(20),
});
export type AutoApproveLimits = z.infer<typeof AutoApproveLimitsSchema>;
export const DEFAULT_AUTO_APPROVE_LIMITS: AutoApproveLimits = {
  enabled: false,
  perTaskMinor: null,
  perMonthMinor: null,
  currency: "usd",
  contacts: [],
  apps: [],
};

export const ActionAutoReviewSettingsSchema = z.object({
  mode: ApprovalModeSchema,
  autoApprove: AutoApproveLimitsSchema,
  /** The stored form of `mode`, kept for clients that predate it. */
  enabled: z.boolean(),
  checkerAvailable: z.boolean(),
  skipApprovals: z.boolean(),
});
export type ActionAutoReviewSettings = z.infer<typeof ActionAutoReviewSettingsSchema>;

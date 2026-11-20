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
 * Approvals the owner lets pass by themselves, within limits: a purchase up to an amount, a send
 * or invite only to listed contacts, or any action in a listed connected app (a purchase there
 * still has to fit the amount). Off unless the owner turns it on. It never covers a run that
 * outside content entered, or an action that always needs a person.
 */
export const AutoApproveLimitsSchema = z.object({
  enabled: z.boolean(),
  /** Largest purchase that passes, in the currency's minor unit (cents); null passes none. */
  maxAmountMinor: z.number().int().min(0).max(1_000_000).nullable(),
  currency: z.string().regex(/^[a-z]{3}$/),
  /** Email addresses a send or invite may go to without asking. */
  contacts: z.array(z.string().trim().toLowerCase().email().max(254)).max(50),
  /** Connected apps, by connector kind, whose actions pass without asking. */
  apps: z.array(z.string().trim().toLowerCase().min(1).max(64)).max(20),
});
export type AutoApproveLimits = z.infer<typeof AutoApproveLimitsSchema>;
export const DEFAULT_AUTO_APPROVE_LIMITS: AutoApproveLimits = {
  enabled: false,
  maxAmountMinor: null,
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

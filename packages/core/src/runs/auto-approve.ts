import type { AutoApproveLimits } from "@rakazo/contracts";

/** What a gated action does, as far as the owner's auto-approve limits care. */
export type AutoApproveAction = {
  /** Every address the action sends to or invites; empty when it reaches nobody. */
  recipients: readonly string[];
  /** Connector kinds the action runs on; empty for a built-in tool. */
  connectorKinds: readonly string[];
  /** The amount a purchase pays, when the action pays and the amount is known. */
  payment?: { minor: number; currency: string } | "unknown";
};

/**
 * Whether the owner's limits let this approval pass without asking. A run that outside content
 * entered never passes: text the bot read must not be able to spend or send within the limits.
 * An action that always needs a person never passes. A purchase must fit the amount even in an
 * allowed app, and one whose amount is unknown never passes.
 */
export function autoApproveCovers(
  limits: AutoApproveLimits | undefined,
  action: AutoApproveAction,
  run: { tainted: boolean; mandatory: boolean },
): boolean {
  if (!limits?.enabled || run.tainted || run.mandatory) return false;
  if (action.payment !== undefined) {
    if (action.payment === "unknown" || limits.maxAmountMinor === null) return false;
    return (
      action.payment.currency.toLowerCase() === limits.currency &&
      action.payment.minor <= limits.maxAmountMinor
    );
  }
  const apps = new Set(limits.apps);
  if (
    action.connectorKinds.length > 0 &&
    action.connectorKinds.every((kind) => apps.has(kind.toLowerCase()))
  )
    return true;
  if (action.recipients.length === 0) return false;
  const contacts = new Set(limits.contacts);
  return action.recipients.every((address) => contacts.has(address.trim().toLowerCase()));
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** Argument names that hold who an action sends to or invites. */
const RECIPIENT_KEY =
  /^(to|cc|bcc|recipients?|recipient_emails?|to_emails?|attendees?|guests?|invitees?|emails?)$/i;

/**
 * Every address an action's arguments send to or invite, at any depth. A value under a recipient
 * key that is not an email address is kept as written so it can never match a contact by
 * accident and the action asks.
 */
export function actionRecipients(args: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown, underRecipient: boolean) => {
    if (typeof value === "string") {
      if (underRecipient)
        found.push(
          ...value
            .split(/[,;]/)
            .map((part) => part.trim())
            .filter(Boolean),
        );
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, underRecipient);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value)) {
      // An attendee object carries its address under `email`.
      visit(inner, underRecipient || RECIPIENT_KEY.test(key));
    }
  };
  visit(args, false);
  return [
    ...new Set(found.map((address) => (EMAIL.test(address) ? address.toLowerCase() : address))),
  ];
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "usd", "€": "eur", "£": "gbp" };

/** A page's amount text such as "$1,234.50" or "EUR 12,00", in minor units, or unknown. */
export function pageAmount(text: string): { minor: number; currency: string } | "unknown" {
  const trimmed = text.trim();
  const before = trimmed.match(/^([$€£]|[A-Za-z]{3})\s*([\d.,]+)$/);
  const after = trimmed.match(/^([\d.,]+)\s*([$€£]|[A-Za-z]{3})$/);
  const unit = before?.[1] ?? after?.[2];
  const digits = before?.[2] ?? after?.[1];
  if (!unit || !digits) return "unknown";
  const currency = CURRENCY_SYMBOLS[unit] ?? unit.toLowerCase();
  // The last separator followed by exactly two digits is the decimal point; others group thousands.
  const decimal = digits.match(/[.,](\d{2})$/);
  const whole = (decimal ? digits.slice(0, -3) : digits).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return "unknown";
  const minor = Number(whole) * 100 + (decimal ? Number(decimal[1]) : 0);
  return Number.isSafeInteger(minor) ? { minor, currency } : "unknown";
}

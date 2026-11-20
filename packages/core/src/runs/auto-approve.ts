import type { AutoApproveLimits } from "@rakazo/contracts";
import { connectorToolRequiresApproval } from "./action-approval.js";

/** The four kinds of action that always ask a person unless the owner's limits cover them. */
export type AlwaysAskCategory = "spend" | "send" | "delete" | "legal";

/** Built-ins that spend money, send as the owner to others, or delete the owner's data. */
const SPEND_BUILTINS = new Set(["paid_request", "service_call"]);
const SEND_BUILTINS = new Set(["send_email"]);
const DELETE_BUILTINS = new Set(["delete_email", "forget_memory"]);

const VERBS = {
  spend:
    "buy|charge|checkout|pay|payment|purchase|order|subscribe|unsubscribe|transfer|donate|tip|refund|payout|withdraw|upgrade|downgrade|renew",
  send: "send|reply|forward|post|publish|share|invite|tweet|retweet|comment|dm|broadcast",
  delete: "delete|remove|trash|destroy|purge|erase|wipe|empty|clear|drop",
  legal: "accept|agree|sign|consent|esign",
} as const;
const word = (verbs: string) => new RegExp(`(^|[_-])(${verbs})([_-]|$)`, "i");
const CONNECTOR_SPEND = word(VERBS.spend);
/** A change to anything that moves money counts as spending, whatever the verb (CANCEL_SUBSCRIPTION). */
const MONEY_NOUN = word(
  "charges?|payments?|payouts?|refunds?|transfers?|subscriptions?|invoices?|billing|plans?|balances?",
);
const CONNECTOR_SEND = word(VERBS.send);
const CONNECTOR_DELETE = word(VERBS.delete);
const CONNECTOR_LEGAL = word(VERBS.legal);
const CATEGORY_VERB = new RegExp(`^(${Object.values(VERBS).join("|")})$`, "i");

const READ_VERB = /^(get|list|search|find|read|fetch)$/i;
const COMPOUND = /[_-](and|or|then)[_-]/i;

/** A single action whose first verb reads (GET_POST), so a later noun names what it reads. */
function readsFirst(slug: string): boolean {
  if (COMPOUND.test(slug)) return false;
  const words = slug.split(/[_-]+/);
  const verb = words.slice(1).find((part) => READ_VERB.test(part) || CATEGORY_VERB.test(part));
  return verb !== undefined && READ_VERB.test(verb);
}

/**
 * Which always-ask kind an action is, if any. `slugs` are the connector actions a call runs (one
 * for a direct connector tool, each inner action of a batch); `recipients` are the addresses its
 * arguments send to or invite, so a connector event with guests counts as a send. `pays` marks a
 * page click that completes a purchase or a saved card's use; `deletesInBulk` a shell bulk delete.
 */
export function alwaysAskCategory(action: {
  toolName: string;
  slugs: readonly string[];
  recipients: readonly string[];
  pays: boolean;
  deletesInBulk: boolean;
}): AlwaysAskCategory | undefined {
  const { toolName } = action;
  // A read never falls in a kind, whatever noun its name carries (GET_POST, FETCH_MESSAGE).
  const slugs = action.slugs.filter(
    (slug) => connectorToolRequiresApproval(slug) && !readsFirst(slug),
  );
  if (
    action.pays ||
    SPEND_BUILTINS.has(toolName) ||
    slugs.some((slug) => CONNECTOR_SPEND.test(slug) || MONEY_NOUN.test(slug))
  )
    return "spend";
  if (slugs.some((slug) => CONNECTOR_LEGAL.test(slug))) return "legal";
  if (
    action.deletesInBulk ||
    DELETE_BUILTINS.has(toolName) ||
    slugs.some((slug) => CONNECTOR_DELETE.test(slug))
  )
    return "delete";
  if (SEND_BUILTINS.has(toolName) || slugs.some((slug) => CONNECTOR_SEND.test(slug))) return "send";
  if (slugs.length > 0 && action.recipients.length > 0) return "send";
  return undefined;
}

/** What a gated action does, as far as the owner's auto-approve limits care. */
export type AutoApproveAction = {
  /** Every address the action sends to or invites; empty when it reaches nobody. */
  recipients: readonly string[];
  /** Connector kinds the action runs on; empty for a built-in tool. */
  connectorKinds: readonly string[];
  /** The amount a spend pays, when the action spends and the amount is known. */
  payment?: { minor: number; currency: string } | "unknown";
};

/** What this task and this calendar month already spent, in the limits' currency. */
export type SpentSoFar = { task: number; month: number };

/**
 * Whether the owner's limits let this approval pass without asking. A run that outside content
 * entered never passes: text the bot read must not be able to spend or send within the limits.
 * An action that always needs a person never passes. A spend must keep both this task's and this
 * month's spending within the caps, even in a trusted app, and one whose amount is unknown never
 * passes.
 */
export function autoApproveCovers(
  limits: AutoApproveLimits | undefined,
  action: AutoApproveAction,
  run: { tainted: boolean; mandatory: boolean; spent?: SpentSoFar },
): boolean {
  if (!limits?.enabled || run.tainted || run.mandatory) return false;
  if (action.payment !== undefined) {
    if (action.payment === "unknown" || !run.spent) return false;
    if (limits.perTaskMinor === null || limits.perMonthMinor === null) return false;
    const { minor, currency } = action.payment;
    return (
      currency.toLowerCase() === limits.currency &&
      run.spent.task + minor <= limits.perTaskMinor &&
      run.spent.month + minor <= limits.perMonthMinor
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

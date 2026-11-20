// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).

/**
 * Gente acts on the person's own computer without asking, except for the four things a person
 * always decides: spending money, sending something as them, deleting their data, and agreeing
 * to legal terms. This finds those in one `user_computer_act` call from what the call itself
 * shows: the purpose the assistant states, the names of the buttons and fields it clicks or
 * sets (read from its latest look at that app), the menu items it picks, and the keys it presses.
 *
 * It is deliberately narrow: typed text is the person's content, not an intent, so it is never
 * read here, and a click on an element whose name is unknown is not guessed at.
 */
export type ScreenActionRisk = "money" | "send" | "delete" | "legal";

export type ScreenRiskAction = {
  kind: string;
  element?: number;
  key?: string;
  modifiers?: readonly string[];
  path?: readonly string[];
};

const RISK_ORDER: readonly ScreenActionRisk[] = ["money", "legal", "delete", "send"];

const WORDS: Record<ScreenActionRisk, RegExp> = {
  money:
    /\b(buy|buy now|purchase|pay|pay now|checkout|check out|place (your )?order|order now|confirm (the )?(order|payment|purchase)|complete (the )?(order|payment|purchase)|subscribe|upgrade (plan|now)|donate|send money|transfer (money|funds)|book (now|and pay)|reserve and pay|add (a )?card)\b/i,
  send: /\b(send|send now|send message|post|publish|tweet|reply all|share|submit|forward)\b/i,
  delete:
    /\b(delete|delete permanently|remove permanently|erase|empty trash|empty (the )?recycle bin|move\b[^.]{0,40}\bto (the )?(trash|bin|recycle bin)|wipe|format disk|discard all|clear (all )?(history|data))\b/i,
  legal:
    /\b(i agree|agree( and continue)?|accept (the )?(terms|conditions|agreement|license|licence|policy|eula)|i accept|sign (the )?(document|contract|agreement)|finish signing|adopt and sign|e-?sign)\b/i,
};

/** Apps where Return sends what was typed. Return in other apps is a line break or a confirm. */
const RETURN_SENDS_APPS =
  /\b(messages|whatsapp|telegram|signal|slack|discord|teams|microsoft teams|messenger|wechat|line|imessage|skype|zoom)\b/i;
const MAIL_APPS = /\b(mail|outlook|thunderbird|spark|airmail|gmail)\b/i;
const FILE_APPS = /\b(finder|file explorer|explorer|files)\b/i;

function textRisk(text: string): ScreenActionRisk | null {
  for (const risk of RISK_ORDER) if (WORDS[risk].test(text)) return risk;
  return null;
}

function keyRisk(app: string, action: ScreenRiskAction): ScreenActionRisk | null {
  const key = (action.key ?? "").toLowerCase();
  const mods = new Set((action.modifiers ?? []).map((mod) => mod.toLowerCase()));
  const command = mods.has("cmd") || mods.has("ctrl");
  if ((key === "return" || key === "enter") && RETURN_SENDS_APPS.test(app)) return "send";
  if ((key === "return" || key === "enter") && command && MAIL_APPS.test(app)) return "send";
  if (key === "d" && mods.has("shift") && command && MAIL_APPS.test(app)) return "send";
  if (FILE_APPS.test(app) && (key === "delete" || key === "backspace" || key === "forwarddelete"))
    return command || mods.has("shift") || key === "delete" ? "delete" : null;
  return null;
}

/**
 * The first of the four the call does, in the order a person most needs to see it, or null.
 * `labels` maps element numbers from the latest observation of `app` to their row text.
 */
export function screenActionRisk(input: {
  app: string;
  actions: readonly ScreenRiskAction[];
  purpose?: string;
  labels?: ReadonlyMap<number, string>;
}): ScreenActionRisk | null {
  const found = new Set<ScreenActionRisk>();
  const add = (risk: ScreenActionRisk | null) => {
    if (risk) found.add(risk);
  };
  if (input.purpose) add(textRisk(input.purpose));
  for (const action of input.actions) {
    if ((action.kind === "click" || action.kind === "set") && action.element !== undefined) {
      const label = input.labels?.get(action.element);
      if (label) add(textRisk(label));
    }
    if (action.kind === "menu" && action.path) add(textRisk(action.path.join(" > ")));
    if (action.kind === "key") add(keyRisk(input.app, action));
  }
  return RISK_ORDER.find((risk) => found.has(risk)) ?? null;
}

/**
 * Row text by element number, from an observation's tree (`[N] role "name" = "value"` rows).
 * Only the role and name are kept: a field's value is the person's content.
 */
export function screenElementLabels(tree: string): Map<number, string> {
  const labels = new Map<number, string>();
  for (const line of tree.split("\n")) {
    const match = /\[(\d+)\]\s*(.*)$/.exec(line);
    if (!match) continue;
    const row = (match[2] ?? "").replace(/\s=\s".*$/, "").trim();
    if (row) labels.set(Number(match[1]), row.slice(0, 200));
  }
  return labels;
}

/** The words a card uses to say what needs the person. */
export const SCREEN_ACTION_RISK_LABELS: Record<ScreenActionRisk, string> = {
  money: "spend money",
  send: "send something as you",
  delete: "delete your data",
  legal: "agree to terms",
};

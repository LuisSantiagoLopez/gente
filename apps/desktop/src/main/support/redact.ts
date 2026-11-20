// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Everything that may leave the computer in an error report passes through here first. Gente's
// promise is that chats never leave the computer, so this errs on the side of removing too much:
// chat text, names, emails, phone numbers, keys, tokens, addresses and the person's own folder
// names all become placeholders. Error codes, stack frames and Gente's own file names stay.
//
// No imports: the self-healing pipeline imports this file as it is (scripts/self-heal).

export type RedactionContext = {
  /** The person's home folder, e.g. /Users/ana or C:\Users\ana. Replaced with `~`. */
  homeDir?: string;
  /** The person's account name, removed wherever it appears. */
  username?: string;
  /** Extra exact strings to remove, such as a Telegram bot name or a contact email. */
  secrets?: readonly string[];
};

/** JSON keys whose values are chat content or personal data. Their values are dropped whole. */
const PRIVATE_KEYS = [
  "content",
  "message_text",
  "text",
  "prompt",
  "messages",
  "body",
  "input",
  "output",
  "completion",
  "reasoning",
  "title",
  "name",
  "email",
  "phone",
  "address",
  "username",
  "first_name",
  "last_name",
  "caption",
  "query",
  "transcript",
  "note",
  "summary",
  "memory",
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "api_key",
  "apikey",
];
const PRIVATE_KEY_PATTERN = PRIVATE_KEYS.join("|");

/** A log line that carries a chat turn, whatever its format. Dropped entirely. */
const CHAT_LINE =
  /("role"\s*:\s*"(user|assistant|system|tool)")|\b(user|assistant)\s*(said|wrote|message)\s*:|\[(chat|turn|message)\]/i;

type Replacement = string | ((match: string) => string);

const RULES: readonly [RegExp, Replacement][] = [
  // Private JSON values: "content": "...", "messages": [...], "text": {...}
  [
    new RegExp(
      `("(?:${PRIVATE_KEY_PATTERN})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|\\{[^}]*\\})`,
      "gi",
    ),
    '$1"[removed]"',
  ],
  // key=value and key: value in plain log lines
  [
    new RegExp(
      `\\b(${PRIVATE_KEY_PATTERN})(\\s*[=:]\\s*)(?!\\[removed\\])("[^"]*"|'[^']*'|\\S+)`,
      "gi",
    ),
    "$1$2[removed]",
  ],
  // Authorization headers
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [key]"],
  // Telegram bot tokens: digits, colon, 35 characters
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "[key]"],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[key]"],
  // Common API key shapes: a short prefix, then a long run with digits (sk-…, ghp_…, xoxb-…)
  [
    /\b(sk|pk|rk|sb|ghp|gho|ghs|ghu|github_pat|xox[abpr]|AKIA|AIza|whsec|ak)[_-][A-Za-z0-9_-]{8,}\b/g,
    "[key]",
  ],
  [/\b[a-z][a-z0-9]{1,10}[_-](?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{24,}\b/g, "[key]"],
  // Emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // URLs: keep scheme and host for local addresses only, drop the rest of every other URL
  [/\bhttps?:\/\/(127\.0\.0\.1|localhost)(:\d+)?[^\s"')]*/g, "http://$1$2/[path]"],
  [/\bhttps?:\/\/[^\s"')]+/g, "[link]"],
  // Card numbers (13 to 19 digits, optional spaces or dashes)
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  // Phone numbers (+52 55 1234 5678, (555) 123-4567, 555-123-4567)
  [/(\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, "[phone]"],
  // IPv4 addresses other than loopback
  [/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  // Quoted sentences are someone's words, not Gente's: plain words only, no codes or paths.
  [/"([^"\n]{12,})"/g, (match) => (isProse(match.slice(1, -1)) ? '"[text]"' : match)],
  [/'([^'\n]{12,})'/g, (match) => (isProse(match.slice(1, -1)) ? "'[text]'" : match)],
  // Long hex or base64 runs (keys, hashes of private data)
  [/\b[A-Fa-f0-9]{40,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9+/]{48,}={0,2}/g, "[blob]"],
];

/** Four or more plain words with no error code, path, number or symbol: a sentence someone wrote. */
function isProse(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 4) return false;
  return words.every((word) => /^[\p{L}'’]+[,.!?;]?$/u.test(word) && !/^[A-Z_]{3,}$/.test(word));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes personal data from one piece of text. */
export function redact(text: string, context: RedactionContext = {}): string {
  let out = text;
  // The home folder first, in both slash styles, so later rules see `~`.
  if (context.homeDir && context.homeDir.length > 3) {
    const forward = context.homeDir.replace(/\\/g, "/");
    const back = context.homeDir.replace(/\//g, "\\");
    for (const variant of new Set([context.homeDir, forward, back, back.replace(/\\/g, "\\\\")])) {
      out = out.replace(new RegExp(escapeRegExp(variant), "gi"), "~");
    }
  }
  // Any other person's folder on the same computer.
  out = out.replace(/([/\\])(Users|home)([/\\]+)[^/\\\s"':]+/gi, "$1$2$3[user]");
  for (const secret of [context.username, ...(context.secrets ?? [])]) {
    if (secret && secret.trim().length >= 3)
      out = out.replace(new RegExp(`\\b${escapeRegExp(secret.trim())}\\b`, "gi"), "[user]");
  }
  for (const [pattern, replacement] of RULES)
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  return out;
}

/**
 * Removes personal data from log lines and drops any line that carries chat content. Very long
 * lines are cut: they are almost always a payload, not an error.
 */
export function redactLogLines(lines: readonly string[], context: RedactionContext = {}): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (CHAT_LINE.test(line)) {
      out.push("[chat line removed]");
      continue;
    }
    const cleaned = redact(line.length > 600 ? `${line.slice(0, 600)} [cut]` : line, context);
    out.push(cleaned);
  }
  return out;
}

/** Redacts every string inside a JSON-like value, keeping its shape. Private keys lose their value. */
export function redactValue<T>(value: T, context: RedactionContext = {}): T {
  const privateKey = new RegExp(`^(${PRIVATE_KEY_PATTERN})$`, "i");
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") return redact(input, context);
    if (Array.isArray(input)) return input.map(walk);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input).map(([key, inner]) => [
          key,
          privateKey.test(key) ? "[removed]" : walk(inner),
        ]),
      );
    }
    return input;
  };
  return walk(value) as T;
}

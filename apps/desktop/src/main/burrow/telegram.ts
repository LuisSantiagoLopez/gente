// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Telegram, the instant way: the person pastes a token from @BotFather and Gente reads the bot's
// messages with Telegram's official long polling (getUpdates). No webhook, no tunnel, no public
// address. Each update is handed to the local server's own Telegram webhook route, signed with a
// secret only this computer knows, so all of Rakazo's Telegram handling (linking, replies, groups)
// works unchanged. Replies go out from the server with the same token.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const TELEGRAM_API = process.env.GENTE_TELEGRAM_API?.trim() || "https://api.telegram.org";
const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function looksLikeBotToken(token: string) {
  return TOKEN_SHAPE.test(token.trim());
}

/** The webhook secret, derived from this computer's stack token so it never needs storing. */
export function telegramSecret(stackToken: string): string {
  return createHash("sha256").update(`gente-telegram:${stackToken}`).digest("hex").slice(0, 48);
}

/** Asks Telegram who the bot is; resolves to its @username, or null for a bad token. */
export async function telegramBotName(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${TELEGRAM_API}/bot${token.trim()}/getMe`, {
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    return body.ok && body.result?.username ? body.result.username : null;
  } catch {
    return null;
  }
}

export function readTelegramToken(platform = process.platform): Promise<string | undefined> {
  if (platform !== "darwin") return Promise.resolve(process.env.TELEGRAM_BOT_TOKEN || undefined);
  return new Promise((resolve) =>
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", "gente", "-s", "TELEGRAM_BOT_TOKEN", "-w"],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
    ),
  );
}

export function saveTelegramToken(token: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) =>
    execFile(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-a", "gente", "-s", "TELEGRAM_BOT_TOKEN", "-w", token.trim()],
      { timeout: 10_000 },
      (error) => resolve(!error),
    ),
  );
}

/** Reads the local API's port from the stack folder (Mac or Windows layout). */
export async function localApiPort(stackDir: string): Promise<number | null> {
  for (const file of [".native-ports", ".windows-ports"]) {
    try {
      const ports = JSON.parse(await readFile(path.join(stackDir, file), "utf8")) as {
        api?: number;
      };
      if (ports.api) return ports.api;
    } catch {
      // Try the other layout.
    }
  }
  return null;
}

/** Long-polls Telegram and forwards each update to the local server. */
export class TelegramPoller {
  private stopped = false;
  private offset = 0;

  constructor(
    private readonly token: string,
    private readonly secret: string,
    private readonly apiPort: () => Promise<number | null>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}

  stop() {
    this.stopped = true;
  }

  async run(maxRounds = Number.POSITIVE_INFINITY) {
    const api = `${TELEGRAM_API}/bot${this.token}`;
    // Long polling and a webhook cannot both be set; a webhook left from elsewhere is removed.
    await this.fetchImpl(`${api}/deleteWebhook`, { method: "POST" }).catch(() => undefined);
    let failures = 0;
    for (let round = 0; round < maxRounds && !this.stopped; round++) {
      try {
        const res = await this.fetchImpl(`${api}/getUpdates?timeout=25&offset=${this.offset}`, {
          signal: AbortSignal.timeout(35_000),
        });
        const body = (await res.json()) as { ok?: boolean; result?: { update_id: number }[] };
        if (!body.ok) throw new Error("getUpdates refused");
        for (const update of body.result ?? []) {
          const port = await this.apiPort();
          if (!port) throw new Error("server not ready");
          const posted = await this.fetchImpl(
            `http://127.0.0.1:${port}/api/v1/messaging/webhook/telegram`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": this.secret,
              },
              body: JSON.stringify(update),
            },
          );
          // A refused hand-off is retried on the next round, not skipped.
          if (!posted.ok) throw new Error(`hand-off ${posted.status}`);
          this.offset = update.update_id + 1;
        }
        failures = 0;
      } catch {
        // Offline or the server is restarting: wait a little longer each time, up to 30 seconds.
        failures++;
        await this.pause(Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)));
      }
    }
  }
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import { looksLikeBotToken, TelegramPoller, telegramBotName, telegramSecret } from "./telegram.js";

const TOKEN = "123456789:AAH_fake_token_value_for_tests_abcdef12";

describe("Your AI Telegram (long polling, no webhook)", () => {
  it("checks a BotFather token and reads the bot's name", async () => {
    expect(looksLikeBotToken(TOKEN)).toBe(true);
    expect(looksLikeBotToken("not a token")).toBe(false);
    const fake = (async (url: string) =>
      new Response(JSON.stringify(String(url).endsWith("/getMe") ? { ok: true, result: { username: "gente_test_bot" } } : {}))) as typeof fetch;
    expect(await telegramBotName(TOKEN, fake)).toBe("gente_test_bot");
  });

  it("forwards each update to the local server with the secret, in order, and retries refused hand-offs", async () => {
    const posted: { url: string; secret: string | null; body: unknown }[] = [];
    let refuseOnce = true;
    const batches = [[{ update_id: 7, message: { text: "hey" } }, { update_id: 8, message: { text: "code 1234" } }], []];
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/deleteWebhook")) return new Response("{}");
      if (u.includes("/getUpdates")) {
        const offset = Number(new URL(u).searchParams.get("offset"));
        const pending = batches[0]!.filter((x) => x.update_id >= offset);
        return new Response(JSON.stringify({ ok: true, result: pending }));
      }
      const headers = new Headers(init?.headers);
      if (refuseOnce) {
        refuseOnce = false;
        return new Response("", { status: 503 });
      }
      posted.push({ url: u, secret: headers.get("x-telegram-bot-api-secret-token"), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const secret = telegramSecret("stack-token");
    const poller = new TelegramPoller(TOKEN, secret, async () => 62888, fake, async () => {});
    await poller.run(3);
    expect(posted.map((p) => (p.body as { update_id: number }).update_id)).toEqual([7, 8]);
    expect(posted.every((p) => p.secret === secret && p.url === "http://127.0.0.1:62888/api/v1/messaging/webhook/telegram")).toBe(true);
  });
});

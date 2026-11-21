// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import path from "node:path";
import { BrowserWindow } from "electron";
import { desktop } from "../desktop-state.js";
import { handleIpc } from "../ipc/ipc.js";
import { readStackToken } from "../this-computer/local-stack.js";
import {
  localApiPort,
  looksLikeBotToken,
  readTelegramToken,
  saveTelegramToken,
  TelegramPoller,
  telegramBotName,
  telegramSecret,
} from "./telegram.js";

let poller: TelegramPoller | null = null;

/** Runs the long-poll hand-off while the workspace is up and a token is saved. */
export async function syncTelegramPoller(stackDir: string, ready: boolean) {
  if (!ready) {
    poller?.stop();
    poller = null;
    return;
  }
  if (poller) return;
  const token = await readTelegramToken();
  const stackToken = await readStackToken(stackDir);
  if (!token || !stackToken) return;
  poller = new TelegramPoller(token, telegramSecret(stackToken), () => localApiPort(stackDir));
  void poller.run();
}

export function registerTelegram(stackDir: string) {
  handleIpc("gente.telegram.connect", async (_event, raw: unknown) => {
    const token = typeof raw === "string" ? raw.trim() : "";
    if (!looksLikeBotToken(token))
      return {
        ok: false,
        message:
          "That doesn't look like a BotFather token. It has a number, a colon, then letters.",
      };
    const username = await telegramBotName(token);
    if (!username)
      return {
        ok: false,
        message: "Telegram didn't recognize that token. Copy it again from BotFather.",
      };
    if (!(await saveTelegramToken(token)))
      return {
        ok: false,
        message: "Your AI couldn't save the token to the keychain. Please try again.",
      };
    // The server reads the token when it starts, so it restarts once (a few seconds).
    poller?.stop();
    poller = null;
    await desktop.localStack.stop().catch(() => undefined);
    await desktop.localStack.start().catch(() => undefined);
    await syncTelegramPoller(stackDir, desktop.localStack.state().phase === "ready");
    return { ok: true, username };
  });
}

export function openTelegramWindow() {
  const open = desktop.telegramWindow;
  if (open && !open.isDestroyed()) {
    open.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 520,
    height: 420,
    title: "Connect Telegram",
    webPreferences: {
      preload: path.join(import.meta.dirname, "telegram-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.setMenuBarVisibility(false);
  void window.loadFile(path.join(import.meta.dirname, "telegram.html"));
  desktop.telegramWindow = window;
  window.on("closed", () => {
    if (desktop.telegramWindow === window) desktop.telegramWindow = null;
  });
}

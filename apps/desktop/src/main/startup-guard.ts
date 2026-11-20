// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The app's entry point. It loads nothing native: it installs the main-process error handlers
// first, then loads the app. If the app cannot load (for example a missing native module), the
// person sees a calm message instead of Electron's raw "JavaScript error" box, and the technical
// detail goes to <userData>/logs/main-errors.log only.
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, dialog } from "electron";

function logFile(): string {
  try {
    return path.join(app.getPath("userData"), "logs", "main-errors.log");
  } catch {
    return path.join(os.tmpdir(), "gente-main-errors.log");
  }
}

export function logMainError(kind: string, error: unknown): void {
  try {
    const file = logFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    appendFileSync(file, `${new Date().toISOString()} ${kind} ${detail}\n`);
  } catch {
    // Logging must never become an error of its own.
  }
}

// Registered before anything else loads: Electron shows its raw error box only when no
// handler is present. Errors after startup are logged; the app's own watchdogs retry.
process.on("uncaughtException", (error) => logMainError("uncaught-exception", error));
process.on("unhandledRejection", (reason) => logMainError("unhandled-rejection", reason));

// Not a literal path, so the bundler leaves the app as its own file.
const entry = new URL("./app-main.js", import.meta.url).href;
try {
  await import(entry);
} catch (error) {
  logMainError("startup", error);
  await app.whenReady();
  dialog.showMessageBoxSync({
    type: "info",
    title: "Gente",
    message: "Gente couldn't open just now.",
    detail:
      "Please open Gente again. If it keeps happening, restart your computer, or download Gente again. Your chats are safe.",
    buttons: ["OK"],
    noLink: true,
  });
  app.exit(1);
}

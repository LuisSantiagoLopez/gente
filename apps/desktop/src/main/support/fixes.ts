// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The safe local fixes the support chat can run with one tap. Each one only touches Gente's own
// services and files: none deletes a chat, a bot, memory or a setting.

export const FIX_IDS = [
  "restart-services",
  "redownload-model",
  "clear-cache",
  "relink-telegram",
] as const;
export type FixId = (typeof FIX_IDS)[number];

export function isFixId(value: unknown): value is FixId {
  return typeof value === "string" && (FIX_IDS as readonly string[]).includes(value);
}

/** The button label for each fix, by language. */
export const FIX_LABELS: Record<FixId, Record<"en" | "es" | "pt", string>> = {
  "restart-services": {
    en: "Restart Gente's services",
    es: "Reiniciar los servicios de Gente",
    pt: "Reiniciar os serviços do Gente",
  },
  "redownload-model": {
    en: "Download the model again",
    es: "Descargar el modelo otra vez",
    pt: "Baixar o modelo de novo",
  },
  "clear-cache": { en: "Clear the cache", es: "Borrar la caché", pt: "Limpar o cache" },
  "relink-telegram": {
    en: "Link Telegram again",
    es: "Vincular Telegram otra vez",
    pt: "Vincular o Telegram de novo",
  },
};

export type FixDeps = {
  /** Starts the model server if it stopped, then stops and starts the workspace. */
  restartServices: () => Promise<boolean>;
  /** Deletes only Gente's model from the model server and downloads it again. */
  redownloadModel: () => Promise<boolean>;
  /** Clears the app's web cache and Gente's temporary files. Chats and settings stay. */
  clearCache: () => Promise<boolean>;
  /** Opens the Telegram link window so the person can paste a fresh token. */
  relinkTelegram: () => Promise<boolean>;
  log: (line: string) => void;
};

export type FixResult = { id: FixId; ok: boolean };

export async function runFix(id: FixId, deps: FixDeps): Promise<FixResult> {
  const work = {
    "restart-services": deps.restartServices,
    "redownload-model": deps.redownloadModel,
    "clear-cache": deps.clearCache,
    "relink-telegram": deps.relinkTelegram,
  }[id];
  try {
    const ok = await work();
    deps.log(`fix ${id}: ${ok ? "done" : "did not help"}`);
    return { id, ok };
  } catch (error) {
    deps.log(`fix ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { id, ok: false };
  }
}

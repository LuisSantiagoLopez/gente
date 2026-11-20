// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The health checks' sentences in the help languages. Keyed by failure code, or by check and
// status when all is well.
import type { HealthReport } from "./health.js";
import type { HelpLang } from "./help-docs.js";

type Copy = Record<"es" | "pt", string>;

const COPY: Record<string, Copy> = {
  OLLAMA_DOWN: {
    es: "El servidor del modelo de Your AI se detuvo. Reiniciarlo casi siempre lo arregla.",
    pt: "O servidor do modelo do Your AI parou. Reiniciar quase sempre resolve.",
  },
  MODEL_MISSING: {
    es: "Falta el modelo de Your AI. Descargarlo otra vez lo arregla.",
    pt: "O modelo do Your AI está faltando. Baixar de novo resolve.",
  },
  MODEL_CORRUPT: {
    es: "La descarga del modelo de Your AI está dañada. Descargarlo otra vez lo arregla.",
    pt: "O download do modelo do Your AI está danificado. Baixar de novo resolve.",
  },
  DISK_LOW: {
    es: "Tu disco está casi lleno ({gb} GB libres). Libera unos GB para que Your AI siga funcionando.",
    pt: "Seu disco está quase cheio ({gb} GB livres). Libere alguns GB para o Your AI continuar funcionando.",
  },
  PORT_IN_USE: {
    es: "Otra app usa la dirección que Your AI necesita. Reiniciar los servicios de Your AI elige una libre.",
    pt: "Outro app está usando o endereço que o Your AI precisa. Reiniciar os serviços do Your AI escolhe um livre.",
  },
  BUNDLE_MODULE_MISSING: {
    es: "Falta una parte de la app de Your AI. Una actualización lo repara; reinstalar también funciona.",
    pt: "Falta uma parte do app do Your AI. Uma atualização conserta; reinstalar também funciona.",
  },
  WORKSPACE_DOWN: {
    es: "El espacio de trabajo de Your AI se detuvo. Reiniciar sus servicios casi siempre lo arregla.",
    pt: "O espaço de trabalho do Your AI parou. Reiniciar os serviços quase sempre resolve.",
  },
  TELEGRAM_UNLINKED: {
    es: "Telegram ya no acepta el vínculo de tu bot. Vincúlalo otra vez en unos segundos.",
    pt: "O Telegram não aceita mais o vínculo do seu bot. Vincule de novo em alguns segundos.",
  },
  "model-server:ok": {
    es: "El servidor del modelo está funcionando.",
    pt: "O servidor do modelo está funcionando.",
  },
  "model:ok": { es: "El modelo está listo.", pt: "O modelo está pronto." },
  "disk:ok": {
    es: "Hay suficiente espacio libre en el disco.",
    pt: "Há espaço livre suficiente no disco.",
  },
  "ports:ok": {
    es: "Las direcciones de Your AI están libres.",
    pt: "Os endereços do Your AI estão livres.",
  },
  "app-files:ok": {
    es: "Los archivos de Your AI están completos.",
    pt: "Os arquivos do Your AI estão completos.",
  },
  "workspace:ok": {
    es: "Tu espacio de trabajo está funcionando.",
    pt: "Seu espaço de trabalho está funcionando.",
  },
  "workspace:warn": {
    es: "Tu espacio de trabajo está arrancando.",
    pt: "Seu espaço de trabalho está iniciando.",
  },
  "telegram:ok": { es: "Telegram está vinculado.", pt: "O Telegram está vinculado." },
};

export function localizeHealth(report: HealthReport, lang: HelpLang): HealthReport {
  if (lang === "en") return report;
  return {
    ...report,
    checks: report.checks.map((check) => {
      const copy = COPY[check.code ?? `${check.id}:${check.status}`]?.[lang];
      if (!copy) return check;
      const gb = /\(([\d.]+) GB/.exec(check.summary)?.[1] ?? "";
      return { ...check, summary: copy.replace("{gb}", gb) };
    }),
  };
}

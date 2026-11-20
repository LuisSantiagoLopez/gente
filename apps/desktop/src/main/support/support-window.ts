// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente Support in the app: the window, its IPC, and the background monitor that heals what it
// can. Everything here runs on this computer; only a ticket or an approved report leaves it.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, Notification, session } from "electron";
import { OLLAMA_URL, ollamaRunning, readSavedBrain, startOllama } from "../burrow/brain.js";
import { rebuildBrain } from "../burrow/brain-ipc.js";
import { stackSelfHeal } from "../burrow/self-heal.js";
import { readTelegramToken, telegramBotName } from "../burrow/telegram.js";
import { openTelegramWindow } from "../burrow/telegram-window.js";
import { desktop } from "../desktop-state.js";
import { handleIpc } from "../ipc/ipc.js";
import { NATIVE_PORTS_FILE } from "../this-computer/native-stack.js";
import { findMissingAppFiles } from "./app-files.js";
import { askSupport, shouldOfferHuman } from "./assistant.js";
import type { SupportViewState } from "./bridge.js";
import { buildDiagnosticsBundle, ErrorCatcher, readLogTails } from "./diagnostics.js";
import type { FixDeps } from "./fixes.js";
import { FIX_IDS, FIX_LABELS, isFixId, runFix } from "./fixes.js";
import type { HealthProbe } from "./health.js";
import { localizeHealth } from "./health-copy.js";
import type { HelpArticle } from "./help-docs.js";
import { HelpIndex, helpLang, loadHelpArticles } from "./help-docs.js";
import { renderMarkdown } from "./markdown.js";
import type { ReportAnswer } from "./monitor.js";
import { SupportMonitor } from "./monitor.js";
import type { HealthEvent } from "./outbox.js";
import { sendDiagnostics, sendHealthEvent, sendTicket } from "./outbox.js";
import {
  freeDiskBytes,
  ollamaModelError,
  ollamaTags,
  ollamaUp,
  portHeldByOther,
} from "./probes.js";
import type { SupportSettings } from "./settings.js";
import { readSupportSettings, writeSupportSettings } from "./settings.js";
import type { SupportTurn } from "./support.prompt.js";

const CHECK_EVERY_MS = 5 * 60_000;
const FIRST_CHECK_MS = 60_000;

type SupportOptions = {
  userDataDir: string;
  stackDir: string;
  locale: () => string;
};

let monitor: SupportMonitor | null = null;
let catcher: ErrorCatcher | null = null;
let healthEvent: (event: HealthEvent) => void = () => {};
let setupCounted = false;

/** Records a failure from elsewhere in the app (for example the workspace giving up after retries). */
export function recordSupportFailure(code: string, source: string, error: unknown) {
  catcher?.record({ code, source, error });
  if (code === "WORKSPACE_DOWN" && !setupCounted) {
    setupCounted = true;
    healthEvent("setup_fail");
  }
  void monitor?.check();
}

/** The workspace came up: counted once per launch for the rollout's setup success rate. */
export function recordWorkspaceReady() {
  if (setupCounted) return;
  setupCounted = true;
  healthEvent("setup_ok");
}

function redactionContext() {
  let username: string | undefined;
  try {
    username = os.userInfo().username;
  } catch {
    username = undefined;
  }
  return { homeDir: os.homedir(), username };
}

function realProbe(options: SupportOptions): HealthProbe {
  const logs = path.join(options.stackDir, "logs");
  return {
    version: app.getVersion(),
    platform: `${process.platform} ${os.release()}`,
    ollamaUp: () => ollamaUp(OLLAMA_URL),
    ollamaTags: () => ollamaTags(OLLAMA_URL),
    modelError: (alias) => ollamaModelError(OLLAMA_URL, alias),
    modelAlias: async () => (await readSavedBrain(options.stackDir))?.alias ?? null,
    freeDiskBytes: () => freeDiskBytes(os.homedir()),
    portConflict: async () => {
      if (desktop.localStack?.state().phase === "ready") return null;
      const ports = JSON.parse(
        await readFile(path.join(options.stackDir, NATIVE_PORTS_FILE), "utf8"),
      ) as {
        api?: number;
      };
      if (typeof ports.api !== "number") return null;
      return { port: ports.api, heldByOther: await portHeldByOther(ports.api) };
    },
    missingAppFiles: async () => {
      const serverDir = app.isPackaged ? path.join(process.resourcesPath, "rakazo-server") : null;
      let manifest = null;
      if (serverDir && existsSync(path.join(serverDir, "manifest.json"))) {
        try {
          manifest = JSON.parse(readFileSync(path.join(serverDir, "manifest.json"), "utf8")) as {
            entrypoints?: Record<string, string>;
          };
        } catch {
          manifest = null;
        }
      }
      const tails = await readLogTails(logs, 200);
      const lines = ["api.log", "worker.log", "web.log"].flatMap((file) => tails[file] ?? []);
      return findMissingAppFiles({
        serverDir: manifest ? serverDir : null,
        manifest,
        exists: existsSync,
        serviceLogLines: lines,
      });
    },
    workspacePhase: () => {
      const state = desktop.localStack?.state();
      if (!state) return "unknown";
      // While the workspace's own quiet retries run, it counts as starting, not failed.
      const phase = stackSelfHeal().present(state).phase;
      if (phase === "ready" || phase === "failed") return phase;
      if (phase === "idle") return "stopped";
      return "starting";
    },
    telegramLinked: async () => {
      const token = await readTelegramToken();
      if (!token) return null;
      return (await telegramBotName(token)) !== null;
    },
  };
}

function realFixes(options: SupportOptions, log: (line: string) => void): FixDeps {
  return {
    restartServices: async () => {
      await startOllama();
      await desktop.localStack.stop().catch(() => undefined);
      const state = await desktop.localStack.start();
      return state.phase === "ready" && (await ollamaRunning());
    },
    redownloadModel: async () => {
      // Only Gente's own model is removed; anything else the person keeps in Ollama stays.
      const saved = await readSavedBrain(options.stackDir);
      if (saved === null) return rebuildBrain();
      for (const model of [saved.alias, saved.model]) {
        await fetch(`${OLLAMA_URL}/api/delete`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(30_000),
        }).catch(() => undefined);
      }
      return rebuildBrain();
    },
    clearCache: async () => {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
      const logs = path.join(options.stackDir, "logs");
      for (const file of await readdir(logs).catch(() => [] as string[]))
        if (file.endsWith(".previous.log")) await rm(path.join(logs, file), { force: true });
      return true;
    },
    relinkTelegram: async () => {
      openTelegramWindow();
      return true;
    },
    log,
  };
}

async function viewState(options: SupportOptions): Promise<SupportViewState> {
  const lang = helpLang(options.locale());
  const pending = monitor?.pending() ?? null;
  return {
    version: app.getVersion(),
    platform: process.platform,
    lang,
    health: (() => {
      const report = monitor?.health() ?? null;
      return report ? localizeHealth(report, lang) : null;
    })(),
    pendingReport: pending
      ? { codes: pending.codes, preview: JSON.stringify(pending, null, 2) }
      : null,
    settings: await readSupportSettings(options.userDataDir),
    fixLabels: Object.fromEntries(
      FIX_IDS.map((id) => [id, FIX_LABELS[id][lang]]),
    ) as SupportViewState["fixLabels"],
  };
}

function helpDir() {
  return path.join(import.meta.dirname, "help");
}

let articles: Promise<HelpArticle[]> | null = null;
let index: Promise<HelpIndex> | null = null;
function helpArticles() {
  articles ??= loadHelpArticles(helpDir());
  return articles;
}
function helpIndex() {
  index ??= helpArticles().then((list) => HelpIndex.fromArticles(list));
  return index;
}

/** Starts the monitor and answers the support window. Call once, after the app is ready. */
export function startSupport(options: SupportOptions) {
  const logDir = path.join(options.stackDir, "logs");
  const log = (line: string) =>
    void mkdir(logDir, { recursive: true })
      .then(() =>
        appendFile(path.join(logDir, "support.log"), `${new Date().toISOString()} ${line}\n`),
      )
      .catch(() => undefined);
  const context = redactionContext();
  catcher = new ErrorCatcher(logDir, context, (caught) => {
    log(`caught ${caught.code} ${caught.signature}`);
    if (caught.code === "APP_CRASH") {
      healthEvent("crash");
      void monitor?.queueReport();
    }
  });
  catcher.install(app);
  const settings = () => readSupportSettings(options.userDataDir);
  let notified = false;
  const pushState = () => {
    const win = desktop.supportWindow;
    if (win && !win.isDestroyed())
      void viewState(options).then((state) => win.webContents.send("gente.support.changed", state));
    if (
      monitor?.pending() &&
      !notified &&
      (!win || win.isDestroyed()) &&
      Notification.isSupported()
    ) {
      notified = true;
      const note = new Notification({
        title: "Gente",
        body: "Gente hit a problem it couldn't fix by itself. Open Support to see what happened.",
      });
      note.on("click", () => openSupportWindow());
      note.show();
    }
  };
  monitor = new SupportMonitor({
    probe: realProbe(options),
    fixes: realFixes(options, log),
    catcher,
    shareChoice: async () => (await settings()).shareDiagnostics,
    buildBundle: async (health) =>
      buildDiagnosticsBundle({
        version: app.getVersion(),
        channel: (await settings()).updateChannel,
        os: {
          platform: process.platform,
          release: os.release(),
          arch: process.arch,
          totalMemBytes: os.totalmem(),
        },
        health,
        errors: catcher?.errors() ?? [],
        logs: await readLogTails(logDir),
        context,
      }),
    send: async (bundle) => {
      const ok = await sendDiagnostics(bundle);
      log(`report ${bundle.id} ${ok ? "sent" : "not sent"}`);
      return ok;
    },
    onChange: pushState,
  });

  // Anonymous health counts for the staged rollout, only when reports are on ("Always send").
  healthEvent = (event) =>
    void (async () => {
      const current = await settings();
      if (current.shareDiagnostics !== "always") return;
      await sendHealthEvent({
        version: app.getVersion(),
        channel: current.updateChannel,
        platform: process.platform,
        event,
        installId: await installId(options.userDataDir),
      });
    })();
  healthEvent("launch");

  setTimeout(() => void monitor?.check(), FIRST_CHECK_MS).unref();
  setInterval(() => void monitor?.check(), CHECK_EVERY_MS).unref();

  let unhelpful = 0;
  let failedFixes = 0;
  handleIpc("gente.support.state", () => viewState(options));
  handleIpc("gente.support.check", async () => {
    await monitor?.check();
    return viewState(options);
  });
  handleIpc("gente.support.ask", (event, rawQuestion, rawHistory) => {
    const id = randomUUID();
    const question = typeof rawQuestion === "string" ? rawQuestion.slice(0, 2000) : "";
    const history: SupportTurn[] = Array.isArray(rawHistory)
      ? rawHistory
          .filter(
            (t): t is SupportTurn =>
              typeof t === "object" &&
              t !== null &&
              (t.role === "user" || t.role === "assistant") &&
              typeof t.content === "string",
          )
          .slice(-6)
      : [];
    const lang = helpLang(options.locale());
    void (async () => {
      const send = (payload: unknown) => {
        if (!event.sender.isDestroyed())
          event.sender.send("gente.support.event", { id, ...(payload as object) });
      };
      for await (const item of askSupport(
        {
          index: await helpIndex(),
          ollamaUrl: OLLAMA_URL,
          modelAlias: async () =>
            (await ollamaRunning())
              ? ((await readSavedBrain(options.stackDir))?.alias ?? null)
              : null,
          health: () => monitor?.health() ?? null,
          version: app.getVersion(),
          platform: `${process.platform} ${os.release()}`,
        },
        question,
        history,
        lang,
      )) {
        if (item.type === "done")
          send({
            ...item,
            offerHuman: shouldOfferHuman({
              modelAskedForHuman: item.human,
              unhelpfulAnswers: unhelpful,
              failedFixes,
              noHelpFound: false,
            }),
          });
        else send(item);
      }
    })();
    return id;
  });
  handleIpc("gente.support.fix", async (_event, rawId) => {
    if (!isFixId(rawId)) return { ok: false, state: await viewState(options) };
    const result = await runFix(rawId, realFixes(options, log));
    if (!result.ok) failedFixes++;
    await monitor?.check();
    return { ok: result.ok, state: await viewState(options) };
  });
  handleIpc("gente.support.feedback", (_event, helpful) => {
    if (helpful === false) unhelpful++;
    return {
      offerHuman: shouldOfferHuman({
        modelAskedForHuman: false,
        unhelpfulAnswers: unhelpful,
        failedFixes,
        noHelpFound: false,
      }),
    };
  });
  handleIpc("gente.support.ticket", async (_event, raw) => {
    const ticket = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const email = typeof ticket.email === "string" ? ticket.email.trim() : "";
    const message = typeof ticket.message === "string" ? ticket.message.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || message.length < 5) return false;
    // The ticket names the version and failure codes, never chat content. A report rides along
    // only when the person ticked the box.
    const health = monitor?.health();
    const codes =
      health?.checks.filter((c) => c.status === "fail" && c.code).map((c) => c.code) ?? [];
    let reportLine = "";
    // Ticking "include an error report" is the person's yes for this one report.
    if (ticket.includeReport === true && monitor) {
      const bundle = await monitor.bundleNow().catch(() => null);
      if (bundle && (await sendDiagnostics(bundle))) reportLine = `\nReport: ${bundle.id}`;
    }
    return sendTicket({
      email,
      name: typeof ticket.name === "string" ? ticket.name.slice(0, 120) : "",
      message: `${message}\n\n-- Gente ${app.getVersion()} on ${process.platform} ${os.release()}. Checks failing: ${codes.join(", ") || "none"}.${reportLine}`,
    });
  });
  handleIpc("gente.support.answerReport", async (_event, answer) => {
    const choice = (["send", "not-now", "always", "never"] as const).find((a) => a === answer);
    if (!choice) return false;
    if (choice === "always" || choice === "never")
      await writeSupportSettings(options.userDataDir, { shareDiagnostics: choice });
    return (await monitor?.answer(choice as ReportAnswer)) ?? false;
  });
  handleIpc("gente.support.saveSettings", async (_event, raw) => {
    const patch = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const next: Partial<SupportSettings> = {};
    if (
      patch.shareDiagnostics === "ask" ||
      patch.shareDiagnostics === "always" ||
      patch.shareDiagnostics === "never"
    )
      next.shareDiagnostics = patch.shareDiagnostics;
    if (patch.updateChannel === "latest" || patch.updateChannel === "canary")
      next.updateChannel = patch.updateChannel;
    return writeSupportSettings(options.userDataDir, next);
  });
  handleIpc("gente.support.articles", async () => {
    const lang = helpLang(options.locale());
    const all = await helpArticles();
    const mine = all.filter((a) => a.lang === lang);
    return (mine.length > 0 ? mine : all.filter((a) => a.lang === "en")).map((a) => ({
      slug: a.slug,
      title: a.title,
      html: renderMarkdown(a.markdown, {
        articleHref: (slug, anchor) => `#${slug}${anchor ? `/${anchor}` : ""}`,
      }),
    }));
  });
}

async function installId(userDataDir: string): Promise<string> {
  const file = path.join(userDataDir, "support-install-id");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const id = randomUUID();
    await mkdir(userDataDir, { recursive: true });
    await writeFile(file, id);
    return id;
  }
}

export function openSupportWindow() {
  const existing = desktop.supportWindow;
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 380,
    minHeight: 480,
    title: "Gente Support",
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, "support-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  desktop.supportWindow = win;
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  void win.loadFile(path.join(import.meta.dirname, "support.html"));
  win.on("closed", () => {
    if (desktop.supportWindow === win) desktop.supportWindow = null;
  });
}

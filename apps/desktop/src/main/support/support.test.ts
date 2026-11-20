// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { findMissingAppFiles } from "./app-files.js";
import type { SupportEvent } from "./assistant.js";
import { askSupport, parseAnswer, shouldOfferHuman } from "./assistant.js";
import { ErrorCatcher } from "./diagnostics.js";
import type { FixDeps } from "./fixes.js";
import type { HealthProbe } from "./health.js";
import { runHealthChecks } from "./health.js";
import { HelpIndex, helpLang, loadHelpArticles, sectionsOf } from "./help-docs.js";
import { renderMarkdown } from "./markdown.js";
import { SupportMonitor } from "./monitor.js";
import { failureSignature, normalizeMessage } from "./signature.js";

const HELP_DIR = path.resolve(import.meta.dirname, "../../../../../docs/gente/help");

function healthyProbe(overrides: Partial<HealthProbe> = {}): HealthProbe {
  return {
    version: "0.2.0",
    platform: "darwin",
    ollamaUp: async () => true,
    ollamaTags: async () => ["swift-1.5-27b:latest"],
    modelError: async () => null,
    modelAlias: async () => "swift-1.5-27b",
    freeDiskBytes: async () => 50e9,
    portConflict: async () => null,
    missingAppFiles: async () => [],
    workspacePhase: () => "ready",
    telegramLinked: async () => null,
    ...overrides,
  };
}

describe("health checks", () => {
  it("passes on a healthy computer", async () => {
    const report = await runHealthChecks(healthyProbe());
    expect(report.overall).toBe("ok");
  });

  it.each([
    ["OLLAMA_DOWN", { ollamaUp: async () => false }, "restart-services"],
    ["MODEL_MISSING", { ollamaTags: async () => [] }, "redownload-model"],
    ["MODEL_CORRUPT", { modelError: async () => "invalid file magic" }, "redownload-model"],
    ["DISK_LOW", { freeDiskBytes: async () => 1e9 }, "clear-cache"],
    [
      "PORT_IN_USE",
      { portConflict: async () => ({ port: 3000, heldByOther: true }) },
      "restart-services",
    ],
    ["BUNDLE_MODULE_MISSING", { missingAppFiles: async () => ["module pg-native"] }, undefined],
    ["WORKSPACE_DOWN", { workspacePhase: () => "failed" as const }, "restart-services"],
  ] as const)("names %s and its fix", async (code, overrides, fix) => {
    const report = await runHealthChecks(healthyProbe(overrides));
    const failed = report.checks.find((c) => c.code === code);
    expect(failed?.status).toBe("fail");
    expect(failed?.fix).toBe(fix);
  });

  it("treats a probe that throws as unknown, never as a crash", async () => {
    const report = await runHealthChecks(
      healthyProbe({
        freeDiskBytes: async () => {
          throw new Error("no statfs");
        },
      }),
    );
    expect(report.checks.find((c) => c.id === "disk")).toBeUndefined();
  });
});

describe("self-healing monitor", () => {
  const fixes = (overrides: Partial<FixDeps> = {}): FixDeps => ({
    restartServices: async () => true,
    redownloadModel: async () => true,
    clearCache: async () => true,
    relinkTelegram: async () => true,
    log: () => {},
    ...overrides,
  });

  it("restarts a stopped model server by itself and records nothing when that works", async () => {
    let up = false;
    const catcher = new ErrorCatcher("/nonexistent-gente-test", {});
    const send = vi.fn(async () => true);
    const monitor = new SupportMonitor({
      probe: healthyProbe({ ollamaUp: async () => up }),
      fixes: fixes({
        restartServices: async () => {
          up = true;
          return true;
        },
      }),
      catcher,
      shareChoice: async () => "always",
      buildBundle: async () => ({}) as never,
      send,
      onChange: () => {},
    });
    const report = await monitor.check();
    expect(report.overall).toBe("ok");
    expect(monitor.healed).toEqual([expect.objectContaining({ code: "OLLAMA_DOWN", ok: true })]);
    expect(catcher.errors()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("asks before sending a report by default, and sends nothing on no", async () => {
    const send = vi.fn(async () => true);
    const monitor = new SupportMonitor({
      probe: healthyProbe({ missingAppFiles: async () => ["module pg-native"] }),
      fixes: fixes(),
      catcher: new ErrorCatcher("/nonexistent-gente-test", {}),
      shareChoice: async () => "ask",
      buildBundle: async () => ({ codes: ["BUNDLE_MODULE_MISSING"] }) as never,
      send,
      onChange: () => {},
    });
    await monitor.check();
    expect(monitor.pending()?.codes).toEqual(["BUNDLE_MODULE_MISSING"]);
    expect(send).not.toHaveBeenCalled();
    expect(await monitor.answer("not-now")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("never builds a report when the person chose never", async () => {
    const buildBundle = vi.fn(async () => ({}) as never);
    const monitor = new SupportMonitor({
      probe: healthyProbe({ freeDiskBytes: async () => 1e8 }),
      fixes: fixes(),
      catcher: new ErrorCatcher("/nonexistent-gente-test", {}),
      shareChoice: async () => "never",
      buildBundle,
      send: async () => true,
      onChange: () => {},
    });
    await monitor.check();
    expect(buildBundle).not.toHaveBeenCalled();
  });
});

describe("health copy", () => {
  it("has every failure and ok sentence in Spanish and Portuguese", async () => {
    const { localizeHealth } = await import("./health-copy.js");
    const failing = await runHealthChecks(
      healthyProbe({
        ollamaTags: async () => [],
        freeDiskBytes: async () => 1.5e9,
        portConflict: async () => ({ port: 1, heldByOther: true }),
        missingAppFiles: async () => ["x"],
        workspacePhase: () => "failed",
        telegramLinked: async () => false,
      }),
    );
    for (const report of [failing, await runHealthChecks(healthyProbe({ telegramLinked: async () => true }))])
      for (const lang of ["es", "pt"] as const) {
        const localized = localizeHealth(report, lang);
        localized.checks.forEach((check, i) => expect(check.summary, `${lang} ${check.id}`).not.toBe(report.checks[i]?.summary));
      }
    expect(localizeHealth(failing, "es").checks.find((c) => c.code === "DISK_LOW")?.summary).toContain("1.5 GB");
  });
});

describe("signatures", () => {
  it("are the same on every computer for the same failure", () => {
    const a = failureSignature({
      code: "PORT_IN_USE",
      source: "setup",
      message: "listen EADDRINUSE 127.0.0.1:3000 at /Users/a/x",
    });
    const b = failureSignature({
      code: "PORT_IN_USE",
      source: "setup",
      message: "listen EADDRINUSE 127.0.0.1:4111 at C:\\Users\\b\\x",
    });
    expect(a).toBe(b);
    expect(normalizeMessage("pulled 123 of 456 bytes")).toBe("pulled <n> of <n> bytes");
  });
});

describe("app files", () => {
  it("finds a missing entry file and a module a service could not load", () => {
    expect(
      findMissingAppFiles({
        serverDir: "/app/rakazo-server",
        manifest: { entrypoints: { api: "api/index.js", worker: "worker/index.js" } },
        exists: (file) => !file.endsWith("worker/index.js"),
        serviceLogLines: ["Error: Cannot find module 'pg-native'", "ok"],
      }),
    ).toEqual(["worker: worker/index.js", "module pg-native"]);
  });
});

describe("help articles", () => {
  let articles: Awaited<ReturnType<typeof loadHelpArticles>> = [];
  beforeAll(async () => {
    articles = await loadHelpArticles(HELP_DIR);
  });

  it("exist in English, Spanish and Portuguese with the same sections", () => {
    const byLang = (lang: string) => articles.filter((a) => a.lang === lang);
    expect(byLang("en").length).toBeGreaterThanOrEqual(6);
    for (const lang of ["es", "pt"]) {
      expect(byLang(lang).map((a) => a.slug)).toEqual(byLang("en").map((a) => a.slug));
      for (const article of byLang(lang)) {
        const english = byLang("en").find((a) => a.slug === article.slug);
        expect(sectionsOf(article).length, `${lang}/${article.slug}`).toBe(
          sectionsOf(english!).length,
        );
      }
    }
  });

  it("finds the right section for real questions", () => {
    const index = HelpIndex.fromArticles(articles);
    const top = (q: string, lang: "en" | "es" | "pt" = "en") =>
      index.search(q, lang, 1)[0]?.section;
    expect(top("my disk is full")?.slug).toBe("troubleshooting");
    expect(top("telegram stopped answering me")?.heading).toMatch(/Telegram/);
    expect(top("how much does pro cost")?.slug).toBe("billing");
    expect(top("does anyone read my chats")?.slug).toBe("privacy");
    expect(top("el disco está lleno", "es")?.lang).toBe("es");
  });

  it("links between articles only to articles that exist", () => {
    const slugs = new Set(articles.map((a) => a.slug));
    for (const article of articles)
      for (const match of article.markdown.matchAll(/\]\(([a-z-]+)(#[a-z0-9-]+)?\)/g))
        expect(slugs.has(match[1] ?? ""), `${article.lang}/${article.slug} -> ${match[1]}`).toBe(
          true,
        );
  });

  it("maps app locales to a help language", () => {
    expect(helpLang("es-MX")).toBe("es");
    expect(helpLang("pt-BR")).toBe("pt");
    expect(helpLang("de")).toBe("en");
  });
});

describe("markdown", () => {
  it("escapes HTML and drops unsafe links", () => {
    const html = renderMarkdown(
      '# Hi <script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://a.example) "q"',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://a.example"');
  });

  it("renders lists, tables and article links", () => {
    const html = renderMarkdown(
      "- a\n- **b**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Plans](billing#plans)",
      {
        articleHref: (slug, anchor) => `/help/${slug}#${anchor}`,
      },
    );
    expect(html).toContain("<ul><li>a</li><li><strong>b</strong></li></ul>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('href="/help/billing#plans"');
  });
});

describe("support assistant", () => {
  const index = new HelpIndex([
    {
      lang: "en",
      slug: "troubleshooting",
      articleTitle: "Fix a problem",
      heading: "The model server stopped",
      anchor: "the-model-server-stopped",
      text: "Gente uses Ollama. Tap Restart Gente's services.",
    },
  ]);
  const collect = async (gen: AsyncGenerator<SupportEvent>) => {
    const events: SupportEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  };

  it("reads fix and human tags and hides them", () => {
    expect(parseAnswer("Try this.\n[fix:restart-services]\n[human]")).toEqual({
      text: "Try this.",
      fix: "restart-services",
      human: true,
    });
    expect(parseAnswer("[fix:format-disk] ok").fix).toBeNull();
  });

  it("streams the local model's answer after the sources", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Tap restart."}}]}',
      'data: {"choices":[{"delta":{"content":"\\n[fix:restart-services]"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    const fetcher = vi.fn(async () => new Response(body)) as unknown as typeof fetch;
    const events = await collect(
      askSupport(
        {
          index,
          ollamaUrl: "http://x",
          modelAlias: async () => "swift-1.5-27b",
          health: () => null,
          version: "0.2.0",
          platform: "darwin",
          fetch: fetcher,
        },
        "the model server stopped",
        [],
        "en",
      ),
    );
    expect(events[0]).toMatchObject({ type: "sources" });
    expect(events.at(-1)).toEqual({
      type: "done",
      text: "Tap restart.",
      fix: "restart-services",
      human: false,
      fromModel: true,
    });
    const sent = JSON.parse(
      String(
        (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1]
          .body,
      ),
    );
    expect(sent.model).toBe("swift-1.5-27b");
    expect(sent.messages[0].content).toContain("The model server stopped");
  });

  it("still answers from the help, with a fix, when the model server is down", async () => {
    const events = await collect(
      askSupport(
        {
          index,
          ollamaUrl: "http://x",
          modelAlias: async () => null,
          health: () => null,
          version: "0.2.0",
          platform: "darwin",
        },
        "model server stopped",
        [],
        "en",
      ),
    );
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", fromModel: false });
    expect(done?.type === "done" && done.text).toContain("Restart Gente's services");
  });

  it("offers a person only when stuck", () => {
    const calm = {
      modelAskedForHuman: false,
      unhelpfulAnswers: 0,
      failedFixes: 0,
      noHelpFound: false,
    };
    expect(shouldOfferHuman(calm)).toBe(false);
    expect(shouldOfferHuman({ ...calm, unhelpfulAnswers: 1 })).toBe(false);
    expect(shouldOfferHuman({ ...calm, unhelpfulAnswers: 2 })).toBe(true);
    expect(shouldOfferHuman({ ...calm, failedFixes: 1 })).toBe(true);
    expect(shouldOfferHuman({ ...calm, modelAskedForHuman: true })).toBe(true);
  });
});

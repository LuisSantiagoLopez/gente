// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Proof that an error report carries no chat content and no personal data. Every private value
// below is planted into a real bundle, and the test fails if any of them survives anywhere in the
// JSON that would be sent.
import { describe, expect, it } from "vitest";
import type { CaughtError } from "./diagnostics.js";
import { buildDiagnosticsBundle } from "./diagnostics.js";
import { redact, redactLogLines } from "./redact.js";
import { failureSignature } from "./signature.js";

const HOME = "/Users/ana.lopez";
const context = { homeDir: HOME, username: "ana.lopez" };

const PRIVATE = {
  chat: "Book me a table for two at Pujol on Friday, it's our anniversary",
  chatEs: "Mándale a mi mamá que llego tarde a la cena",
  email: "ana.lopez@example.com",
  phone: "+52 55 1234 5678",
  telegramToken: "7123456789:AAHk9vQ2xYzW3bC4dE5fG6hI7jK8lM9nO0p",
  openAiKey: "sk-proj-abcdefghijklmnopqrstuvwx1234",
  supabaseKey: "sb_secret_abcdefghijklmnop123456",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbmEifQ.c2lnbmF0dXJlc2lnbmF0dXJl",
  card: "4242 4242 4242 4242",
  ip: "189.203.44.17",
  link: "https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmnpqrst",
  homePath: `${HOME}/Documents/taxes-2026.pdf`,
  windowsPath: "C:\\Users\\ana.lopez\\AppData\\Roaming\\Gente\\stack\\logs\\api.log",
  username: "ana.lopez",
  botName: "AnaHelperBot",
};

const error = (message: string, stack?: string): CaughtError => ({
  at: "2026-11-19T10:00:00.000Z",
  code: "OLLAMA_DOWN",
  source: "main",
  message,
  ...(stack ? { stack } : {}),
  signature: failureSignature({ code: "OLLAMA_DOWN", source: "main", message, stack }),
});

describe("error report redaction", () => {
  const bundle = buildDiagnosticsBundle({
    version: "0.2.0",
    channel: "latest",
    os: { platform: "darwin", release: "25.6.0", arch: "arm64", totalMemBytes: 16 * 1024 ** 3 },
    health: {
      checkedAt: "2026-11-19T10:00:00.000Z",
      version: "0.2.0",
      platform: "darwin",
      overall: "fail",
      checks: [
        {
          id: "model-server",
          status: "fail",
          code: "OLLAMA_DOWN",
          summary: "stopped",
          fix: "restart-services",
        },
      ],
    },
    errors: [
      error(
        `connect ECONNREFUSED 127.0.0.1:11434 while sending "${PRIVATE.chat}" for ${PRIVATE.email}`,
        `Error: connect ECONNREFUSED 127.0.0.1:11434\n    at TCPConnectWrap.afterConnect (node:net:1611:16)\n    at Brain.prepare (${HOME}/Applications/Gente.app/Contents/Resources/app.asar/dist/main.js:812:11)`,
      ),
    ],
    logs: {
      "api.log": [
        `2026-11-19T10:00:00Z INFO run started bot=${PRIVATE.botName}`,
        `{"level":"info","msg":"turn","messages":[{"role":"user","content":"${PRIVATE.chat}"}]}`,
        `{"level":"error","msg":"send failed","content":"${PRIVATE.chatEs}","error":"ECONNRESET"}`,
        `user said: ${PRIVATE.chatEs}`,
        `telegram poll failed token=${PRIVATE.telegramToken}`,
        `Authorization: Bearer ${PRIVATE.openAiKey}`,
        `supabase key ${PRIVATE.supabaseKey} jwt ${PRIVATE.jwt}`,
        `payment card ${PRIVATE.card} from ${PRIVATE.ip}`,
        `opened ${PRIVATE.link}`,
        `reading ${PRIVATE.homePath}`,
        `log at ${PRIVATE.windowsPath}`,
        `contact ${PRIVATE.phone}`,
        "Error: Cannot find module 'pg-native'",
      ],
      "setup.log": [
        `2026-11-19T09:59:00Z pull hf.co/ukisai/Swift attempt 1: ENOSPC no space left on device`,
      ],
    },
    context: { ...context, secrets: [PRIVATE.botName] },
  });
  const sent = JSON.stringify(bundle);

  it.each(Object.entries(PRIVATE))("removes %s", (_name, value) => {
    expect(sent).not.toContain(value);
  });

  it("removes any word of the chat messages", () => {
    for (const word of ["Pujol", "anniversary", "mamá", "cena"]) expect(sent).not.toContain(word);
  });

  it("keeps what the pipeline needs to group and reproduce", () => {
    expect(bundle.codes).toContain("OLLAMA_DOWN");
    expect(bundle.app.version).toBe("0.2.0");
    expect(bundle.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(bundle.os).toEqual({
      platform: "darwin",
      release: "25.6.0",
      arch: "arm64",
      memoryGB: 16,
    });
    expect(sent).toContain("ECONNREFUSED 127.0.0.1:11434");
    expect(sent).toContain("Brain.prepare");
    expect(sent).toContain("main.js:812:11");
    expect(sent).toContain("Cannot find module 'pg-native'");
    expect(sent).toContain("ENOSPC no space left on device");
    expect(bundle.failures[0]?.signature).toMatch(/^OLLAMA_DOWN-[0-9a-f]{10}$/);
  });
});

describe("redact", () => {
  it("replaces the home folder in both slash styles", () => {
    expect(redact("/Users/ana.lopez/x", context)).toBe("~/x");
    expect(redact("C:\\Users\\ana.lopez\\x", { homeDir: "C:\\Users\\ana.lopez" })).toBe("~\\x");
  });

  it("keeps error codes and local addresses", () => {
    expect(redact("listen EADDRINUSE: address already in use 127.0.0.1:3000")).toBe(
      "listen EADDRINUSE: address already in use 127.0.0.1:3000",
    );
  });

  it("drops chat lines whatever their format", () => {
    expect(redactLogLines(['{"role":"assistant","content":"hola"}'])).toEqual([
      "[chat line removed]",
    ]);
  });
});

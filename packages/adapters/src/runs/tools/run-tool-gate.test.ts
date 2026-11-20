import type * as Core from "@rakazo/core";
import type * as Db from "@rakazo/db";
import { recordAuditEvent } from "@rakazo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gateToolCall } from "./run-tool-gate.js";
import type { ToolRequest } from "./run-tool-request.js";

const plans = vi.hoisted(() => [] as string[]);
vi.mock("@rakazo/core", async (importOriginal) => {
  const core = await importOriginal<typeof Core>();
  return {
    ...core,
    planActionGate: (input: Parameters<typeof core.planActionGate>[0]) => {
      const plan = core.planActionGate(input);
      plans.push(plan);
      return plan;
    },
  };
});
vi.mock("@rakazo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  recordAuditEvent: vi.fn(async () => {}),
}));
// Recording the effect a person answers is where an ask begins; the test stops there.
vi.mock("../lifecycle/run-effects.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordEffect: vi.fn(async () => {
    throw new Error("asks the user");
  }),
}));

const loginUse = {
  kind: "login" as const,
  login: "work",
  site: "https://login.example.test",
  title: "login.example.test",
  fields: ["Password"],
  savedAt: "2026-09-01T00:00:01.000Z",
};

function gate(options: {
  trigger?: string;
  neverAsk?: boolean;
  rule?: "always_allow" | "deny";
  asks?: boolean;
}) {
  const args = { actions: [{ kind: "fill_secret", ref: "e1", secret: "work", field: "Password" }] };
  const executionId = JSON.stringify(["pi-tool", "main", "call-1"]);
  const request: ToolRequest = {
    name: "browser_act",
    args,
    executionId,
    connectorCall: { tool: "browser_act", args, executionId, route: undefined },
    effectRequest: args,
    resolvedTool: undefined,
    catalogRemapped: false,
    nextApprovedTool: undefined,
    approvedEffectKey: undefined,
    replayEffectToolName: "browser_act",
    fleetSummary: undefined,
    heldForApproval: false,
    settingsChange: false,
    ignoresAllowRules: false,
    purchase: undefined,
    cardUse: undefined,
    loginUse: options.asks === false ? undefined : loginUse,
  };
  const ctx = {
    deps: { prisma: {} },
    run: { id: "run-1", userId: "user-1", spaceId: "space-1", trigger: options.trigger ?? "user" },
    runId: "run-1",
    bot: { id: "bot-1", name: "Helper" },
    thread: { id: "thread-1" },
    context: { signal: new AbortController().signal },
    source: { ownerStartedRun: true },
    tools: { connector: new Map(), connectedPlugins: [] },
    state: {
      tainted: false,
      effects: { consumedIds: new Set(), counts: new Map(), occurrences: [] },
    },
    trust: {
      loadApprovalRules: async () =>
        options.rule
          ? [{ effect: options.rule, matchKind: "tool", matchValue: "browser_act" }]
          : [],
      loadAutoReviewPreference: async () => ({
        enabled: false,
        skipApprovals: Boolean(options.neverAsk),
      }),
    },
  };
  return gateToolCall(ctx as never, request, undefined).then(
    (outcome) => outcome,
    (error: Error) => error.message,
  );
}

describe("gateToolCall: a login that asks first", () => {
  beforeEach(() => {
    plans.length = 0;
  });

  it("asks the user every time in Ask and Auto, even over an Always allow rule", async () => {
    for (const options of [{}, { rule: "always_allow" as const }]) {
      plans.length = 0;
      expect(await gate(options)).toBe("asks the user");
      expect(plans).toEqual(["ask"]);
    }
  });

  it("runs it without asking in Never ask", async () => {
    plans.length = 0;
    await gate({ neverAsk: true });
    expect(plans).toEqual(["allow"]);
  });

  it("asks in a webhook run too, where the card expires if nobody answers", async () => {
    plans.length = 0;
    expect(await gate({ trigger: "webhook" })).toBe("asks the user");
    expect(plans).toEqual(["ask"]);
  });

  it("is refused by a rule that blocks the tool", async () => {
    expect(await gate({ rule: "deny" })).toEqual({
      result: { error: expect.stringContaining("is blocked in this space") },
    });
  });
});

const limits = {
  enabled: true,
  maxAmountMinor: 2_000,
  currency: "usd",
  contacts: ["maria@example.com"],
  apps: [],
};

function sendEmail(to: string[], options: { autoApprove?: typeof limits; tainted?: boolean }) {
  const args = { to, subject: "Hi", text: "See you at 8" };
  const executionId = JSON.stringify(["pi-tool", "main", "call-2"]);
  const request = {
    name: "send_email",
    args,
    executionId,
    connectorCall: { tool: "send_email", args, executionId, route: undefined },
    effectRequest: args,
    replayEffectToolName: "send_email",
    heldForApproval: false,
    settingsChange: false,
    ignoresAllowRules: false,
    catalogRemapped: false,
  } as unknown as ToolRequest;
  const ctx = {
    deps: { prisma: { attempt: { count: async () => 1 } } },
    run: { id: "run-1", userId: "user-1", spaceId: "space-1", trigger: "user" },
    runId: "run-1",
    bot: { id: "bot-1", name: "Helper" },
    thread: { id: "thread-1" },
    context: { signal: new AbortController().signal },
    source: { ownerStartedRun: true },
    tools: { connector: new Map(), connectedPlugins: [] },
    state: {
      tainted: Boolean(options.tainted),
      effects: { consumedIds: new Set(), counts: new Map(), occurrences: [] },
    },
    trust: {
      receivedOutsideMessage: async () => false,
      loadApprovalRules: async () => [],
      loadAutoReviewPreference: async () => ({
        enabled: false,
        skipApprovals: false,
        ...(options.autoApprove ? { autoApprove: options.autoApprove } : {}),
      }),
    },
  };
  return gateToolCall(ctx as never, request, undefined).then(
    (outcome) => outcome,
    (error: Error) => error.message,
  );
}

const autoApprovedAudits = () =>
  vi
    .mocked(recordAuditEvent)
    .mock.calls.filter(([event]) => event.metadata?.reason === "auto_approved").length;

describe("gateToolCall: the owner's auto-approve limits", () => {
  beforeEach(() => {
    plans.length = 0;
    vi.mocked(recordAuditEvent).mockClear();
  });

  it("asks for a send when the limits are off, as before", async () => {
    await sendEmail(["maria@example.com"], {});
    expect(plans).toEqual(["ask"]);
    expect(autoApprovedAudits()).toBe(0);
  });

  it("passes a send to a listed contact by itself", async () => {
    await sendEmail(["maria@example.com"], { autoApprove: limits });
    expect(autoApprovedAudits()).toBe(1);
  });

  it("still asks for a send that reaches anyone not listed", async () => {
    await sendEmail(["maria@example.com", "someone@example.com"], { autoApprove: limits });
    expect(autoApprovedAudits()).toBe(0);
  });

  it("still asks once outside content entered the run", async () => {
    await sendEmail(["maria@example.com"], { autoApprove: limits, tainted: true });
    expect(autoApprovedAudits()).toBe(0);
  });
});

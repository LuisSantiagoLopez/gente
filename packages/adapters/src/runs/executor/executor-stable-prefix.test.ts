import type { AgentRunRequest } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "../../computers/computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

vi.mock("../../computers/computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  waitForRunComputerLease: async (
    _prisma: unknown,
    input: { computerId: string; botId: string; runId: string },
  ) => ({ ...input, fence: 7 }),
  acquireDedicatedScreenLeaseFence: async (
    _prisma: unknown,
    input: { computerId: string; botId: string; runId: string },
  ) => ({ ...input, fence: 7 }),
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
  renewComputerExecutionLease: async () => true,
}));

type Turn = {
  /** What the person typed this turn. */
  text: string;
  /** The clock when the run starts. */
  now: string;
  /** The bot's durable memory when the run starts. */
  memory: string;
  /** Earlier messages of the chat, oldest first. */
  earlier: Array<{ role: "user" | "bot"; text: string }>;
};

function storedMessage(id: string, seq: number, role: string, text: string, runId: string) {
  return {
    id,
    threadId: "thread-1",
    seq,
    role,
    runId,
    blocks: [{ kind: "text", text }] as MessageBlock[],
    replyToMessageId: null,
    replyQuote: null,
    replyTo: null,
    steeringMessages: [] as Array<{ id: string }>,
    createdAt: new Date("2026-03-02T09:00:00Z"),
  };
}

/** Runs one chat turn through the shared executor and returns what reached the runtime. */
async function runTurn(turn: Turn, runId: string): Promise<AgentRunRequest> {
  const run = {
    id: runId,
    botId: "bot-1",
    threadId: "thread-1",
    taskId: `task-${runId}`,
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: "user",
    sourceMessageId: `message-${runId}`,
    leaseFence: 0,
  };
  // Newest first, as the history read returns them.
  const messages = [
    storedMessage(`message-${runId}`, turn.earlier.length + 1, "user", turn.text, runId),
    ...turn.earlier
      .map((message, index) =>
        storedMessage(`earlier-${index}`, index + 1, message.role, message.text, `run-${index}`),
      )
      .reverse(),
  ];
  let request: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (next: AgentRunRequest) {
    request = next;
    yield { type: "done" as const, text: "Done" };
  });
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    space: { findUnique: vi.fn(async () => null) },
    spaceMember: {
      findUnique: vi.fn(async () => ({ id: "member-1" })),
      findMany: vi.fn(async () => [{ userId: "user-1" }]),
    },
    user: { findUnique: vi.fn(async () => null) },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      findFirst: vi.fn(async () => ({
        bot: { id: run.botId, name: "Boris", color: "blue", avatarSet: "default" },
        thread: { groupId: null },
      })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    chatGroup: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        modelProvider: null,
        modelId: null,
        thinkingLevel: null,
        computerId: "computer-1",
        computerSwitching: false,
        memoryScope: null,
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: `attempt-${runId}` })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        groupId: null,
        historyCompactionSummary: null,
        historyCompactedUpToSeq: null,
        nextMessageSeq: messages.length + 1,
      })),
    },
    message: {
      findMany: vi.fn(async (args: { where?: { threadId?: string } }) =>
        args.where?.threadId ? messages : [],
      ),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
    },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: turn.text })) },
    computer: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({
        state: "running",
        restorePending: false,
        screenGeneration: 0,
      })),
    },
    connection: { findMany: vi.fn(async () => []) },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    secret: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    userModelRoleChoice: { findMany: vi.fn(async () => []) },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "openrouter",
        defaultModelId: "openai/gpt-4o",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    vaultCredential: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    externalEffect: { findMany: vi.fn(async () => []) },
    spaceSettingOverride: { findUnique: async () => null },
    userActionApprovalRule: { findMany: vi.fn(async () => []) },
    userActionAutoReviewPreference: { findUnique: vi.fn(async () => null) },
    artifact: { findMany: vi.fn(async () => []) },
  };
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const executor = createRunExecutor({
    prisma,
    deploymentModelKey: "fake-deployment-key",
    now: () => new Date(turn.now),
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      releaseScreen: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      listFiles: vi.fn(async () => []),
      readFile: vi.fn().mockRejectedValue(new Error("missing")),
      exportWorkspace: vi.fn(async function* () {
        yield* [];
      }),
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: {
      read: async (scope: { scope: string }) => ({
        documents:
          scope.scope === "bot"
            ? [{ path: "MEMORY.md", revision: turn.memory ? 2 : 1, content: turn.memory }]
            : [],
      }),
    },
    memoryProviders: { resolve: async () => null },
    artifacts: { get: vi.fn(async () => new Uint8Array()) },
    events: {
      append: vi.fn(async () => undefined),
      finalizeRun,
      claimSteering: vi.fn(async () => []),
    },
    jobs: { enqueue: vi.fn(async () => undefined) },
    secrets: [],
    secretStore: { load: async () => "fake-key" },
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  expect(finalizeRun).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  if (!request) throw new Error("runtime was not called");
  return request;
}

describe("the request prefix stays the same between turns of one chat", () => {
  it("keeps instructions and tools byte-identical and carries time and memory on the turn's message", async () => {
    const first = await runTurn(
      {
        text: "remember my favorite color is blue",
        now: "2026-03-02T09:15:00Z",
        memory: "",
        earlier: [
          { role: "user", text: "hi" },
          { role: "bot", text: "Hello! How can I help?" },
        ],
      },
      "run-1",
    );
    const second = await runTurn(
      {
        text: "what is my favorite color?",
        now: "2026-03-02T09:16:30Z",
        memory: "Favorite color: blue.",
        earlier: [
          { role: "user", text: "hi" },
          { role: "bot", text: "Hello! How can I help?" },
          { role: "user", text: "remember my favorite color is blue" },
          { role: "bot", text: "Saved." },
        ],
      },
      "run-2",
    );

    // A model server reuses what it already read only for an identical prefix.
    expect(second.instructions).toBe(first.instructions);
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));
    for (const volatile of ["2026-03-02", "Current date and time", "Favorite color", "MEMORY.md"])
      expect(first.instructions).not.toContain(volatile);
    // History starts with the chat's own messages, so earlier turns stay a shared prefix.
    expect(second.history.slice(0, 2).map((message) => message.content)).toEqual([
      "hi",
      "Hello! How can I help?",
    ]);
    expect(JSON.stringify(second.history)).not.toContain("Favorite color");

    // The volatile parts still reach the model, after the person's words.
    expect(second.prompt.startsWith("what is my favorite color?")).toBe(true);
    expect(second.prompt).toContain("2026-03-02T09:16:30Z");
    expect(second.prompt).toContain("Favorite color: blue.");
    expect(second.prompt.indexOf("<current_time>")).toBeGreaterThan(
      second.prompt.indexOf("what is my favorite color?"),
    );
    expect(second.prompt.trimEnd().endsWith("</turn_context>")).toBe(true);
    expect(first.prompt).toContain("2026-03-02T09:15:00Z");
  });
});

import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { deferred } from "@rakazo/core/test-async";
import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "../assembly/run-context.js";
import { createReplyState } from "../lifecycle/run-progress.js";
import { consumeRunEvents } from "./run-turn.js";

type Appended = { type: string; payload: Record<string, unknown>; at: number };

async function liveContext() {
  const appended: Appended[] = [];
  const deps = {
    prisma: {
      message: { findMany: async () => [] },
      run: {
        updateMany: async () => ({ count: 1 }),
        findUnique: async () => ({
          status: "running",
          leaseOwner: "worker-1",
          leaseFence: 1,
          checkpoint: null,
        }),
      },
    },
    events: {
      append: vi.fn(async (event: { type: string; payload: Record<string, unknown> }) => {
        appended.push({ type: event.type, payload: event.payload, at: performance.now() });
      }),
    },
  };
  const run = {
    id: "run-1",
    botId: "bot-1",
    spaceId: "space-1",
    userId: "user-1",
    threadId: "thread-1",
    trigger: "message",
  };
  const reply = await createReplyState(deps as never, run as never, []);
  const ctx = {
    deps,
    run,
    runId: run.id,
    workerId: "worker-1",
    fence: 1,
    bot: { id: run.botId },
    thread: { id: run.threadId },
    state: {
      reply,
      approval: { pausePending: false },
      lease: { valid: true, lastCheckAt: 0 },
      toolCallStreak: {},
      toolResults: new Map(),
      overLimitActionCalls: 0,
    },
    abortController: new AbortController(),
    computer: { heldForTakeover: false },
    secrets: [],
    scripted: false,
    replyMode: "chat",
    allowSilentEmptyRun: false,
    groupReplyOptional: false,
  } as unknown as RunContext;
  return { ctx, appended };
}

const progress = (appended: Appended[]) => appended.filter((e) => e.type === "thread.progress");

describe("live streaming", () => {
  it("shows the model's first token within 300 ms", async () => {
    const { ctx, appended } = await liveContext();
    const hold = deferred<void>();
    let firstTokenAt = 0;
    async function* events(): AsyncGenerator<AgentRuntimeEvent> {
      firstTokenAt = performance.now();
      yield { type: "text", text: "Hello" };
      await hold.promise;
    }
    const consumed = consumeRunEvents(ctx, events());
    await vi.waitFor(() => expect(progress(appended)).toHaveLength(1), { timeout: 300 });
    const [first] = progress(appended);
    expect(first?.payload.text).toBe("Hello");
    expect((first?.at ?? Infinity) - firstTokenAt).toBeLessThan(300);
    hold.resolve();
    await consumed;
  });

  it("sends the last words of a burst while the model is quiet", async () => {
    const { ctx, appended } = await liveContext();
    const hold = deferred<void>();
    async function* events(): AsyncGenerator<AgentRuntimeEvent> {
      yield { type: "text", text: "One" };
      yield { type: "text", text: " two" };
      yield { type: "text", text: " three" };
      // The model goes quiet (writing a tool call, say) with text still batched.
      await hold.promise;
    }
    const consumed = consumeRunEvents(ctx, events());
    await vi.waitFor(
      () =>
        expect(
          progress(appended)
            .map((e) => String(e.payload.text ?? e.payload.delta ?? ""))
            .join(""),
        ).toBe("One two three"),
      { timeout: 300 },
    );
    hold.resolve();
    await consumed;
  });

  it("streams thinking and a tool call's arguments as drafts", async () => {
    const { ctx, appended } = await liveContext();
    const hold = deferred<void>();
    async function* events(): AsyncGenerator<AgentRuntimeEvent> {
      yield { type: "draft", thinking: "The user wants " };
      yield { type: "draft", thinking: "a file." };
      yield { type: "draft", tool: { name: "write_file", args: '{"path":"a.md","content":"# Hi' } };
      await hold.promise;
    }
    const consumed = consumeRunEvents(ctx, events());
    await vi.waitFor(
      () => {
        const drafts = progress(appended).map(
          (e) => e.payload.draft as { thinking?: string; tool?: { args: string } },
        );
        expect(drafts.map((d) => d.thinking ?? "").join("")).toBe("The user wants a file.");
        expect(drafts.map((d) => d.tool?.args ?? "").join("")).toBe(
          '{"path":"a.md","content":"# Hi',
        );
      },
      { timeout: 300 },
    );
    // A draft never touches the reply text.
    for (const event of progress(appended)) {
      expect(event.payload.text).toBeUndefined();
      expect(event.payload.delta).toBeUndefined();
    }
    hold.resolve();
    await consumed;
  });
});

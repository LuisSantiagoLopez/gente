// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { GenteLinkMessage, ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { LinkRpc } from "./link-bridge";
import { createLinkBridge } from "./link-bridge";

const msg = (id: string, role: "user" | "bot", blocks: unknown[], runId?: string): ThreadMessage =>
  ({
    id,
    threadId: "t1",
    seq: 1,
    role,
    blocks,
    runId,
    createdAt: "2026-11-20T10:00:00.000Z",
  }) as ThreadMessage;

function setup() {
  const sent: GenteLinkMessage[] = [];
  const answers: unknown[] = [];
  const paths: string[] = [];
  let messages: ThreadMessage[] = [
    msg("m1", "user", [{ kind: "text", text: "Hola" }]),
    msg("m2", "bot", [{ kind: "text", text: "¡Hola! ¿En qué te ayudo?" }]),
  ];
  let run: { id: string; status: string } | null = null;
  const rpc: LinkRpc = {
    bots: { list: async () => [{ id: "bot1", name: "Ana" }] },
    threads: {
      get: async () => ({ messages, run }),
      messages: async () => ({ messages }),
      send: async () => {
        run = { id: "run1", status: "running" };
        return { runId: "run1" };
      },
      answer: async (input) => {
        answers.push(input);
        return { ok: true };
      },
    },
    memory: {
      list: async () =>
        [
          {
            id: "d1",
            scope: "user",
            botId: null,
            path: "me.md",
            content: "Likes tea",
            revision: 1,
            updatedAt: "2026-11-19T00:00:00.000Z",
          },
        ] as never,
    },
  };
  const bridge = createLinkBridge({
    rpc,
    send: async (m) => {
      sent.push(m);
      return true;
    },
    navigate: (p) => paths.push(p),
  });
  return {
    bridge,
    sent,
    answers,
    paths,
    setMessages: (next: ThreadMessage[]) => (messages = next),
    setRun: (next: typeof run) => (run = next),
  };
}

describe("the phone, through this computer", () => {
  it("sends recent chats and memory after the phone says hello", async () => {
    const t = setup();
    await t.bridge.handle({ type: "hello" });
    expect(t.sent[0]).toMatchObject({
      type: "sync.chat",
      id: "bot1",
      title: "Ana",
      messages: [
        { id: "m1", role: "user", text: "Hola" },
        { id: "m2", role: "assistant", text: "¡Hola! ¿En qué te ayudo?", ranOn: "desktop" },
      ],
    });
    expect(t.sent[1]).toMatchObject({
      type: "sync.memory",
      items: [{ id: "d1", text: "Likes tea" }],
    });
  });

  it("runs a phone task, forwards its approval, applies the answer, and reports done", async () => {
    const t = setup();
    await t.bridge.handle({
      type: "task.start",
      taskId: "task1",
      text: "Email Ana that Thursday works",
    });
    expect(t.sent.map((m) => [m.type, m.state])).toEqual([["task.status", "queued"]]);

    t.setMessages([
      msg("u1", "user", [{ kind: "text", text: "Email Ana that Thursday works" }], "run1"),
      msg(
        "a1",
        "bot",
        [
          {
            kind: "ask",
            text: "Send this email as you?",
            approvalEffectId: "e1",
            outgoingDraft: { to: "ana@x" },
            status: "pending",
          },
        ],
        "run1",
      ),
    ]);
    t.setRun({ id: "run1", status: "waiting_input" });
    await t.bridge.watch();
    expect(t.sent.slice(1)).toEqual([
      {
        type: "approval.request",
        id: "bot1:a1",
        kind: "send_as_user",
        title: "Send this email as you?",
        detail: "",
      },
      {
        type: "task.status",
        taskId: "task1",
        state: "running",
        text: "Working on it on your computer",
      },
    ]);

    await t.bridge.handle({ type: "approval.decision", id: "bot1:a1", approved: true });
    expect(t.answers).toEqual([{ botId: "bot1", runId: "run1", messageId: "a1", answer: "allow" }]);

    t.setMessages([
      msg("u1", "user", [{ kind: "text", text: "Email Ana that Thursday works" }], "run1"),
      msg("a2", "bot", [{ kind: "text", text: "Sent. Ana has it." }], "run1"),
    ]);
    t.setRun({ id: "run1", status: "completed" });
    await t.bridge.watch();
    expect(t.sent.at(-2)).toEqual({
      type: "task.status",
      taskId: "task1",
      state: "done",
      text: "Sent. Ana has it.",
    });
    expect(t.sent.at(-1)).toMatchObject({ type: "sync.chat", id: "bot1" });
    expect(t.bridge.pendingTasks()).toBe(0);
  });

  it("opens the chat the phone hands off, and ignores anything that isn't a chat id", async () => {
    const t = setup();
    await t.bridge.handle({ type: "handoff", chatId: "bot1" });
    await t.bridge.handle({ type: "handoff", chatId: "../settings" });
    expect(t.paths).toEqual(["/app/bot1"]);
  });

  it("ignores an approval it never asked for", async () => {
    const t = setup();
    await t.bridge.handle({ type: "approval.decision", id: "bot1:nope", approved: true });
    expect(t.answers).toEqual([]);
  });
});

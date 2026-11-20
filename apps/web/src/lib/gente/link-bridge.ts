// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The app window's side of Gente Link v1: what the paired phone sees and does through this
// computer. It sends recent chats and memory, runs a task the phone started as a normal chat
// message, forwards approval cards and applies the phone's answer, and opens a chat on handoff.
// Everything goes through the desktop app, which seals it for the phone.
import type { GenteLinkMessage, MemoryDocument, ThreadMessage } from "@rakazo/contracts";

export interface LinkRpc {
  bots: { list(): Promise<{ id: string; name: string }[]> };
  threads: {
    get(input: { botId: string }): Promise<{
      messages: ThreadMessage[];
      run: { id: string; status: string } | null;
    }>;
    messages(input: { botId: string }): Promise<{ messages: ThreadMessage[] }>;
    send(input: { botId: string; text: string; clientNonce?: string }): Promise<{ runId: string }>;
    answer(input: {
      botId: string;
      runId: string;
      messageId: string;
      answer: string;
    }): Promise<unknown>;
  };
  memory: { list(input: { scope?: "bot" | "user" }): Promise<MemoryDocument[]> };
}

export interface LinkBridgeDeps {
  rpc: LinkRpc;
  send: (message: GenteLinkMessage) => Promise<boolean>;
  navigate: (path: string) => void;
  now?: () => number;
}

const CHAT_LIMIT = 10;
const MESSAGE_LIMIT = 30;
const MEMORY_LIMIT = 50;
const DONE = new Set(["completed", "failed", "cancelled"]);

type AskBlock = Extract<ThreadMessage["blocks"][number], { kind: "ask" }>;

/** The plain text of a message: its text blocks, joined. */
export function messageText(message: ThreadMessage): string {
  return message.blocks
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** Which kind of approval a card is, as the phone shows it. */
export function approvalKind(block: AskBlock): "money" | "send_as_user" | "other" {
  if (block.receipt) return "money";
  if (block.outgoingDraft) return "send_as_user";
  return "other";
}

function chatMessages(messages: ThreadMessage[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "bot")
    .map((m) => ({ m, text: messageText(m) }))
    .filter(({ text }) => text.length > 0)
    .slice(-MESSAGE_LIMIT)
    .map(({ m, text }) => ({
      id: m.id,
      // The phone calls the bot's side "assistant".
      role: m.role === "bot" ? "assistant" : "user",
      text,
      createdAt: Date.parse(m.createdAt),
      // Answers here ran on this computer (its model, or Gente Cloud on its behalf).
      ...(m.role === "bot" ? { ranOn: "desktop" } : {}),
    }));
}

export function createLinkBridge(deps: LinkBridgeDeps) {
  const now = deps.now ?? Date.now;
  /** Phone task id → the chat it runs in. */
  const tasks = new Map<string, { botId: string; runId: string; state: string }>();
  /** Approval id sent to the phone → where to answer it. */
  const approvals = new Map<string, { botId: string; runId: string; messageId: string }>();

  async function syncChat(bot: { id: string; name: string }) {
    const page = await deps.rpc.threads.messages({ botId: bot.id });
    const messages = chatMessages(page.messages);
    if (!messages.length) return;
    await deps.send({
      type: "sync.chat",
      id: bot.id,
      title: bot.name,
      updatedAt: messages.at(-1)!.createdAt,
      messages,
    });
  }

  async function syncAll() {
    const bots = (await deps.rpc.bots.list()).slice(0, CHAT_LIMIT);
    for (const bot of bots) await syncChat(bot).catch(() => undefined);
    const memory = await deps.rpc.memory.list({ scope: "user" }).catch(() => []);
    await deps.send({
      type: "sync.memory",
      items: memory.slice(0, MEMORY_LIMIT).map((doc) => ({
        id: doc.id,
        text: doc.content.slice(0, 2000),
        createdAt: Date.parse(doc.updatedAt),
      })),
    });
  }

  async function startTask(taskId: string, text: string) {
    const bot = (await deps.rpc.bots.list())[0];
    if (!bot) {
      await deps.send({
        type: "task.status",
        taskId,
        state: "failed",
        text: "No bot on this computer yet",
      });
      return;
    }
    await deps.send({ type: "task.status", taskId, state: "queued", text: `Sent to ${bot.name}` });
    try {
      const sent = await deps.rpc.threads.send({
        botId: bot.id,
        text,
        clientNonce: `link:${taskId}`,
      });
      tasks.set(taskId, { botId: bot.id, runId: sent.runId, state: "queued" });
    } catch {
      await deps.send({ type: "task.status", taskId, state: "failed", text: "Couldn't start it" });
    }
  }

  /** Checks each phone task: its state, and any approval card it is waiting on. */
  async function watch() {
    for (const [taskId, task] of tasks) {
      const thread = await deps.rpc.threads.get({ botId: task.botId }).catch(() => null);
      if (!thread) continue;
      for (const message of thread.messages) {
        if (message.runId !== task.runId) continue;
        for (const block of message.blocks) {
          if (block.kind !== "ask" || !block.approvalEffectId || block.status === "answered")
            continue;
          const id = `${task.botId}:${message.id}`;
          if (approvals.has(id)) continue;
          approvals.set(id, { botId: task.botId, runId: task.runId, messageId: message.id });
          await deps.send({
            type: "approval.request",
            id,
            kind: approvalKind(block),
            title: block.text.slice(0, 200),
            detail: (block.detail ?? "").slice(0, 2000),
          });
        }
      }
      const run = thread.run?.id === task.runId ? thread.run : null;
      const status =
        run?.status ??
        (thread.messages.some((m) => m.runId === task.runId && m.role === "bot")
          ? "completed"
          : task.state);
      const state = DONE.has(status)
        ? status === "completed"
          ? "done"
          : status === "cancelled"
            ? "stopped"
            : "failed"
        : status === "queued" || status === "leased"
          ? "queued"
          : "running";
      if (state === task.state) continue;
      task.state = state;
      const reply = thread.messages
        .filter((m) => m.runId === task.runId && m.role === "bot")
        .at(-1);
      const line =
        state === "done"
          ? (reply ? messageText(reply).split("\n")[0]!.slice(0, 200) : "") || "Done"
          : state === "running"
            ? "Working on it on your computer"
            : state === "queued"
              ? "Waiting to start"
              : state === "stopped"
                ? "Stopped"
                : "It didn't finish";
      await deps.send({ type: "task.status", taskId, state, text: line });
      if (DONE.has(status)) {
        tasks.delete(taskId);
        const bot = (await deps.rpc.bots.list()).find((b) => b.id === task.botId);
        if (bot) await syncChat(bot).catch(() => undefined);
      }
    }
  }

  async function handle(message: GenteLinkMessage) {
    switch (message.type) {
      case "hello":
        await syncAll();
        break;
      case "task.start": {
        const taskId = String(message.taskId ?? "");
        const text = String(message.text ?? "").trim();
        if (taskId && text) await startTask(taskId, text.slice(0, 8000));
        break;
      }
      case "approval.decision": {
        const target = approvals.get(String(message.id ?? ""));
        if (!target) break;
        approvals.delete(String(message.id));
        await deps.rpc.threads
          .answer({ ...target, answer: message.approved === true ? "allow" : "deny" })
          .catch(() => undefined);
        break;
      }
      case "handoff": {
        const chatId = String(message.chatId ?? "");
        if (/^[\w-]{1,64}$/.test(chatId)) deps.navigate(`/app/${chatId}`);
        break;
      }
      default:
        // sync.chat and sync.memory from the phone: the phone keeps its own copy; nothing to merge yet.
        break;
    }
  }

  return { handle, watch, syncAll, pendingTasks: () => tasks.size, at: now };
}

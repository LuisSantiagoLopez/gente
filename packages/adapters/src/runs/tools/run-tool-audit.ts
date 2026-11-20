// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// Split out of run-tool-gate.ts (Rakazo, by Elie Steinbock) by DeskHead Inc. in 2026 for Gente.
import { humanizeToolName } from "@rakazo/core";
import type { AuditEventInput } from "@rakazo/db";
import { recordAuditEvent } from "@rakazo/db";
import type { RunContext } from "../assembly/run-context.js";

/** A bot's consequential tool call, recorded in its organization's audit log. */
export async function auditToolCall(
  ctx: RunContext,
  tool: string,
  outcome: "success" | "failure" | "denied",
  metadata: AuditEventInput["metadata"],
  recorded: Pick<AuditEventInput, "action" | "actor"> = {
    action: "tool.call",
    actor: { type: "bot", id: ctx.bot.id, label: ctx.bot.name },
  },
): Promise<void> {
  await recordAuditEvent({
    ...recorded,
    spaceId: ctx.run.spaceId,
    target: { type: "tool", id: tool, label: humanizeToolName(tool) },
    outcome,
    runId: ctx.runId,
    threadId: ctx.thread.id,
    metadata,
  });
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Finds what the live run is writing right now (its thinking and any tool call's arguments)
// in the run's live progress message, for the reply's activity row. Used by transcript.tsx.
import type { ThreadMessage } from "@rakazo/contracts";
import type { LiveRunDraft } from "../../components/messages/RunActivityRow";

export function liveRunDraft(
  messages: readonly ThreadMessage[],
  runId: string | undefined,
): LiveRunDraft | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (!message.id.startsWith("progress:") || (runId && message.runId !== runId)) continue;
    for (const block of message.blocks) {
      if (block.kind === "progress" && (block.thinking || block.toolDraft))
        return { thinking: block.thinking, toolDraft: block.toolDraft };
    }
  }
  return undefined;
}

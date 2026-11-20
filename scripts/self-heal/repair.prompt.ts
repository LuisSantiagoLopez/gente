// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Instructions for the repair agent (a CI model or the local model). Two separate steps, so the
// pipeline can check each one: first a failing test only, then a fix that makes it pass.
import type { Cluster } from "./intake.js";

export const REPAIR_PROMPT_VERSION = "repair-1";

function facts(cluster: Cluster): string {
  return `Failure code: ${cluster.code}
Signature: ${cluster.signature}
Seen in ${cluster.reports} reports, app versions ${cluster.versions.join(", ")}, on ${cluster.platforms.join(", ")}.
Where: ${cluster.source}
Message (redacted): ${cluster.message}
Stack (redacted): ${cluster.stack ?? "none"}
Health checks in a sample report: ${JSON.stringify(cluster.sample.health)}
Last log lines (redacted): ${JSON.stringify(cluster.sample.logs).slice(0, 6000)}`;
}

export function reproducePrompt(cluster: Cluster, testDir: string): string {
  return `You are fixing a bug in Gente, an Electron app (apps/desktop) that runs a local model through Ollama.
People's computers reported this failure. The report is redacted: it has no chat content or personal data.

${facts(cluster)}

Step 1 of 2: reproduce it. Write ONE new test file under ${testDir} that fails today because of this bug and will pass once it is fixed.
- Test Gente's code, not the person's computer: fake the disk, the network or Ollama the way the existing tests in apps/desktop/src do.
- Change no other file. The pipeline rejects a step 1 that touches anything but one new test file.
- Print the test file path on the last line of your answer.`;
}

export function fixPrompt(cluster: Cluster, testFile: string, failure: string): string {
  return `You are fixing a bug in Gente, an Electron app (apps/desktop) that runs a local model through Ollama.

${facts(cluster)}

Step 2 of 2: make this failing test pass by fixing Gente's code: ${testFile}
Its failure today:
${failure.slice(0, 4000)}

Rules:
- Do not edit, rename or delete the test. The pipeline rejects a fix that changes it.
- Keep the fix small and in the code that owns the behavior. Never show a raw error to the person; follow AGENTS.md.
- Do not add dependencies, network calls, or anything that sends data off the computer.`;
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Step 5: the safety gates a fix must pass before it reaches anyone. No gate may be skipped: a
// gate that did not run counts as failed. The only exception is a dry run on a laptop, where the
// packaged-app smoke test is marked "simulated" because it needs a real build on a CI runner.
import { spawn } from "node:child_process";

export type GateName = "reproduce-test" | "full-tests" | "packaged-smoke" | "chaos";
export const REQUIRED_GATES: readonly GateName[] = [
  "reproduce-test",
  "full-tests",
  "packaged-smoke",
  "chaos",
];

export type GateResult = {
  gate: GateName;
  status: "passed" | "failed" | "simulated";
  command: string;
  seconds: number;
  output: string;
};

export type Gate = { gate: GateName; command: string[]; cwd: string; simulate?: string };

export function runCommand(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const [program, ...args] = command;
    const child = spawn(program ?? "", args, { cwd, env, shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

export async function runGates(gates: readonly Gate[]): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const started = Date.now();
    if (gate.simulate !== undefined) {
      results.push({
        gate: gate.gate,
        status: "simulated",
        command: gate.command.join(" "),
        seconds: 0,
        output: gate.simulate,
      });
      continue;
    }
    const { code, output } = await runCommand(gate.command, gate.cwd);
    results.push({
      gate: gate.gate,
      status: code === 0 ? "passed" : "failed",
      command: gate.command.join(" "),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      output: output.slice(-4000),
    });
    // A failed gate stops the run: later gates would only spend CI time.
    if (code !== 0) break;
  }
  return results;
}

/**
 * Whether a fix may move on. Every required gate must have run and passed. "simulated" passes only
 * in a dry run; in CI it fails like a skipped test.
 */
export function gatesPassed(
  results: readonly GateResult[],
  mode: "ci" | "dry-run",
): { ok: boolean; reason: string } {
  for (const gate of REQUIRED_GATES) {
    const result = results.find((r) => r.gate === gate);
    if (!result) return { ok: false, reason: `${gate} did not run` };
    if (result.status === "failed") return { ok: false, reason: `${gate} failed` };
    if (result.status === "simulated" && mode === "ci")
      return { ok: false, reason: `${gate} was not run for real` };
  }
  return { ok: true, reason: "all gates passed" };
}

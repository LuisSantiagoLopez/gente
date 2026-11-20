// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The real reads behind the health checks: the model server, the disk and the local ports. No
// Electron here, so the pipeline's chaos tests run the very same code against injected faults.
import { statfs } from "node:fs/promises";
import { connect } from "node:net";

export async function ollamaUp(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

export async function ollamaTags(base: string): Promise<string[]> {
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
  const body = (await res.json()) as { models?: { name: string }[] };
  return (body.models ?? []).map((m) => m.name);
}

/** null when Ollama can describe the model; its complaint when the files are damaged. */
export async function ollamaModelError(base: string, alias: string): Promise<string | null> {
  const res = await fetch(`${base}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: alias }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return null;
  return `show ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

export async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Something answers on the port, but it is not Gente's API (its /health does not answer ok). */
export async function portHeldByOther(port: number): Promise<boolean> {
  if (!(await portAnswers(port))) return false;
  const ours = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  return !ours;
}

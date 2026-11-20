// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Service } from "./native-stack.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gente-logs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeChild() {
  const child = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { pid: 4242, exitCode: null, signalCode: null });
  child.kill = vi.fn(() => {
    child.emit("exit", 0, null);
    return true;
  });
  return child;
}

async function service(maxLogBytes: number) {
  const child = fakeChild();
  const svc = new Service(
    { name: "worker", command: "node", args: [], cwd: dir, env: {}, stopSignal: "SIGTERM" },
    { spawn: () => child, logDir: dir, runDir: dir, onCrash: () => false, maxLogBytes },
  );
  return { svc, child };
}

const write = async (child: ReturnType<typeof fakeChild>, text: string) => {
  child.stdout.write(text);
  await vi.waitFor(() => expect(child.stdout.readableLength).toBe(0));
};

describe("service logs", () => {
  it("rotate at the size limit while the service keeps running, keeping one previous log", async () => {
    const { svc, child } = await service(100);
    svc.start();
    await write(child, `${"a".repeat(60)}\n`);
    await write(child, `${"b".repeat(60)}\n`);
    await write(child, `${"c".repeat(60)}\n`);
    await write(child, `${"d".repeat(60)}\n`);
    await svc.stop();

    const current = await readFile(path.join(dir, "worker.log"), "utf8");
    const previous = await readFile(path.join(dir, "worker.previous.log"), "utf8");
    // Two rotations: the newest full log replaced the first one.
    expect(previous).toBe(`${"c".repeat(60)}\n${"d".repeat(60)}\n`);
    expect(current).toBe("");
  });

  it("counts what an earlier launch left in the log toward the limit", async () => {
    await writeFile(path.join(dir, "worker.log"), "x".repeat(90));
    const { svc, child } = await service(100);
    svc.start();
    await write(child, `${"y".repeat(20)}\n`);
    await svc.stop();

    expect(await readFile(path.join(dir, "worker.previous.log"), "utf8")).toBe(
      `${"x".repeat(90)}${"y".repeat(20)}\n`,
    );
    expect(await readFile(path.join(dir, "worker.log"), "utf8")).toBe("");
  });
});

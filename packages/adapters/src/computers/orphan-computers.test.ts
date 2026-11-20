// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPUTER_OWNER_METADATA_KEY,
  computerOwnerTag,
  createOrphanComputerSweeper,
  ORPHAN_GRACE_MS,
} from "./orphan-computers.js";
import type { RemoteDesktopSdk } from "./sandbox/remote-desktop-sandbox.js";
import {
  RemoteDesktopSandboxProvider,
  remoteDesktopCreateOptions,
} from "./sandbox/remote-desktop-sandbox.js";

const NOW = Date.UTC(2026, 0, 1, 12);
const ago = (ms: number) => new Date(NOW - ms);

function setup(
  machines: Array<{ providerRef: string; startedAt: Date }>,
  rows: Array<{ providerRef: string; state: string; updatedAt: Date }>,
) {
  const sandbox = {
    listOwnedRunning: vi.fn(async () =>
      machines.map((machine) => ({ kind: "e2b" as const, ...machine })),
    ),
    destroy: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  const findMany = vi.fn(async () =>
    rows.map((row) => ({ id: `c-${row.providerRef}`, kind: "e2b", ...row })),
  );
  const sweep = createOrphanComputerSweeper(
    { prisma: { computer: { findMany } } as never, sandbox },
    { now: () => NOW },
  );
  const refs = (mock: typeof sandbox.destroy) =>
    mock.mock.calls.map((call) => (call as unknown as [{ providerRef: string }])[0].providerRef);
  return { sandbox, findMany, sweep, refs };
}

describe("orphan computer sweep", () => {
  it("deletes an old machine no computer names and pauses one recorded as stopped", async () => {
    const { sandbox, sweep, refs } = setup(
      [
        { providerRef: "lost", startedAt: ago(ORPHAN_GRACE_MS + 1) },
        { providerRef: "failed-pause", startedAt: ago(2 * ORPHAN_GRACE_MS) },
      ],
      [{ providerRef: "failed-pause", state: "stopped", updatedAt: ago(ORPHAN_GRACE_MS) }],
    );
    await sweep();
    expect(refs(sandbox.destroy)).toEqual(["lost"]);
    expect(refs(sandbox.stop)).toEqual(["failed-pause"]);
  });

  it("leaves young machines, machines recorded as up, and recently changed rows alone", async () => {
    const { sandbox, sweep } = setup(
      [
        { providerRef: "starting", startedAt: ago(ORPHAN_GRACE_MS - 1) },
        { providerRef: "busy", startedAt: ago(3 * ORPHAN_GRACE_MS) },
        { providerRef: "just-stopped", startedAt: ago(3 * ORPHAN_GRACE_MS) },
      ],
      [
        { providerRef: "busy", state: "running", updatedAt: ago(3 * ORPHAN_GRACE_MS) },
        { providerRef: "just-stopped", state: "stopped", updatedAt: ago(60_000) },
      ],
    );
    await sweep();
    expect(sandbox.destroy).not.toHaveBeenCalled();
    expect(sandbox.stop).not.toHaveBeenCalled();
  });

  it("runs at most once per interval and keeps going past one failed machine", async () => {
    const { sandbox, sweep, refs } = setup(
      [
        { providerRef: "a", startedAt: ago(ORPHAN_GRACE_MS) },
        { providerRef: "b", startedAt: ago(ORPHAN_GRACE_MS) },
      ],
      [],
    );
    sandbox.destroy.mockRejectedValueOnce(new Error("provider down"));
    await sweep();
    await sweep();
    expect(sandbox.listOwnedRunning).toHaveBeenCalledTimes(1);
    expect(refs(sandbox.destroy)).toEqual(["a", "b"]);
  });
});

describe("computer owner tag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is stable for a deployment, differs between deployments, and is absent without a secret", () => {
    expect(computerOwnerTag("one")).toBe(computerOwnerTag("one"));
    expect(computerOwnerTag("one")).not.toBe(computerOwnerTag("two"));
    expect(computerOwnerTag("")).toBeUndefined();
    expect(computerOwnerTag("one")).not.toContain("one");
  });

  it("tags new machines and lists only this deployment's running ones", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "deployment-secret");
    const owner = computerOwnerTag()!;
    expect(remoteDesktopCreateOptions("bot", "key").metadata).toMatchObject({
      [COMPUTER_OWNER_METADATA_KEY]: owner,
    });
    const listRunning = vi.fn(async () => [{ id: "sbx", startedAt: ago(1) }]);
    const provider = new RemoteDesktopSandboxProvider({
      id: "e2b",
      label: "Test",
      apiKey: "key",
      sdk: { listRunning } as unknown as RemoteDesktopSdk,
      template: "t",
      isTimeoutError: () => false,
    });
    const signal = new AbortController().signal;
    expect(await provider.listOwnedRunning(signal)).toEqual([
      { kind: "e2b", providerRef: "sbx", startedAt: ago(1) },
    ]);
    expect(listRunning).toHaveBeenCalledWith({
      apiKey: "key",
      metadata: { [COMPUTER_OWNER_METADATA_KEY]: owner },
      signal,
    });

    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(remoteDesktopCreateOptions("bot", "key").metadata).not.toHaveProperty(
      COMPUTER_OWNER_METADATA_KEY,
    );
    expect(await provider.listOwnedRunning(signal)).toEqual([]);
  });
});

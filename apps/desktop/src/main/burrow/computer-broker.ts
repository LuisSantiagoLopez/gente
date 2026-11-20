// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Bots' cloud computers through Gente Cloud: a loopback broker (secret path) between Gente's
// server and /v1/sessions. It starts a metered session with the person's sign-in, heartbeats it
// while the computer runs, and stops it when the server is done, so hours are billed only while a
// computer runs. The server only ever sees the session's per-computer token, never a vendor key.
import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { CLOUD_COMPUTER_SESSION } from "@rakazo/adapters/desktop-server-env";
import type { CloudSession, GenteCloud } from "./gente-cloud.js";

interface Live {
  session: CloudSession;
  timer: NodeJS.Timeout;
}

export async function startComputerBroker(cloud: () => GenteCloud | null) {
  const secret = randomBytes(24).toString("hex");
  const live = new Map<string, Live>(); // by sandboxId

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const stop = async (sandboxId: string) => {
    const entry = live.get(sandboxId);
    if (!entry) return;
    clearInterval(entry.timer);
    live.delete(sandboxId);
    await cloud()?.stopSession(entry.session.sessionId).catch(() => undefined);
  };

  const server: Server = createServer(async (req, res) => {
    const prefix = `/${secret}`;
    if (!req.url?.startsWith(prefix)) return send(res, 404, { error: "not_found" });
    const path = req.url.slice(prefix.length);
    for await (const _ of req) {
      // Bodies are small and fixed; nothing to read from them.
    }
    const client = cloud();
    if (!client) return send(res, 401, { error: "missing_token", message: "Sign in to Your AI to use a cloud computer." });
    try {
      if (req.method === "POST" && path === "/sessions") {
        const session = await client.startSession(CLOUD_COMPUTER_SESSION);
        if (!("sandboxId" in session.connection)) return send(res, 502, { error: "unexpected_session" });
        const sandboxId = session.connection.sandboxId;
        const timer = setInterval(() => {
          void client
            .heartbeat(session.sessionId)
            .then((beat) => {
              if (beat.ending) void stop(sandboxId);
            })
            .catch(() => void stop(sandboxId));
        }, Math.max(10, session.heartbeatEverySeconds) * 1000);
        timer.unref();
        live.set(sandboxId, { session, timer });
        return send(res, 200, { sessionId: session.sessionId, connection: session.connection });
      }
      const match = /^\/sessions\/by-sandbox\/([^/]+)(\/state|\/stop)?$/.exec(path);
      if (match) {
        const sandboxId = decodeURIComponent(match[1]!);
        const entry = live.get(sandboxId);
        if (match[2] === "/stop") {
          await stop(sandboxId);
          return send(res, 200, { stopped: true });
        }
        if (match[2] === "/state") return send(res, 200, { running: Boolean(entry) });
        if (!entry) return send(res, 404, { error: "not_running" });
        return send(res, 200, { sessionId: entry.session.sessionId, connection: entry.session.connection });
      }
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "unknown";
      const status = (error as { status?: number }).status ?? 502;
      return send(res, status || 502, { error: code, message: (error as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/${secret}`,
    /** Stops every running cloud computer (app quit), so nothing keeps billing. */
    async closeAll() {
      await Promise.all([...live.keys()].map((id) => stop(id)));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The app's only door to Gente Cloud (https://gente-cloud.vercel.app, API in gente-cloud/cloud/API.md).
// Vendor keys never reach the app: cloud computers come back as per-session connections, and search
// and Composio go through the cloud's metered proxy. Every call carries the person's Clerk session.

export const GENTE_CLOUD_URL = process.env.GENTE_CLOUD_URL?.trim() || "https://gente-cloud.vercel.app";

export type CloudErrorCode =
  | "missing_token"
  | "invalid_token"
  | "plan_has_no_cloud"
  | "out_of_credit"
  | "admin_only"
  | "invalid_input"
  | "rate_limited"
  | "billing_not_configured"
  | "offline"
  | "unknown";

export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

export interface PlanStatus {
  plan: string;
  planVersion?: number | string;
  [key: string]: unknown;
}

export interface CloudSession {
  sessionId: string;
  leaseUntil: string;
  heartbeatEverySeconds: number;
  connection:
    | { sandboxId: string; envdAccessToken: string; domain: string }
    | { connectUrl: string; liveViewUrl: string };
}

export interface Heartbeat {
  leaseUntil: string;
  ending?: boolean;
  endReason?: "out_of_credit" | "task_cap";
}

type Fetch = typeof fetch;

export interface GenteCloudOptions {
  /** The person's current Clerk session token, or null when signed out. */
  token: () => Promise<string | null>;
  baseUrl?: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

export function createGenteCloud(options: GenteCloudOptions) {
  const base = (options.baseUrl ?? GENTE_CLOUD_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let planEtag: string | undefined;
  let lastPlan: PlanStatus | undefined;

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; data: T | undefined; response: Response }> {
    const token = await options.token();
    if (!token) throw new CloudError("missing_token", 401, "Sign in to use Gente online.");
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CloudError("offline", 0, "Gente can't reach the internet right now.");
    }
    if (response.status === 304) return { status: 304, data: undefined, response };
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : undefined;
    if (!response.ok) {
      const error = (data ?? {}) as { error?: string; message?: string };
      const known: CloudErrorCode[] = [
        "missing_token",
        "invalid_token",
        "plan_has_no_cloud",
        "out_of_credit",
        "admin_only",
        "invalid_input",
        "rate_limited",
        "billing_not_configured",
      ];
      const code = known.includes(error.error as CloudErrorCode)
        ? (error.error as CloudErrorCode)
        : "unknown";
      throw new CloudError(code, response.status, error.message ?? "Gente Cloud said no.");
    }
    return { status: response.status, data, response };
  }

  return {
    /** Plan status; returns the cached one when the cloud says nothing changed (ETag). */
    async plan(): Promise<{ plan: PlanStatus; changed: boolean }> {
      const result = await call<PlanStatus>(
        "GET",
        "/v1/me/plan",
        undefined,
        planEtag ? { "if-none-match": planEtag } : {},
      );
      if (result.status === 304 && lastPlan) return { plan: lastPlan, changed: false };
      planEtag = result.response.headers.get("etag") ?? undefined;
      lastPlan = result.data!;
      return { plan: lastPlan, changed: true };
    },

    balance: async () =>
      (await call<{ planSeconds: number; topupSeconds: number; totalSeconds: number; totalHours: number }>(
        "GET",
        "/v1/balance",
      )).data!,

    /** A metered cloud computer. The connection is for this session only. */
    startSession: async (input: { vendor: "e2b" | "browserbase"; taskKind?: string; maxSeconds?: number }) =>
      (await call<CloudSession>("POST", "/v1/sessions", input)).data!,
    heartbeat: async (sessionId: string) =>
      (await call<Heartbeat>("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {})).data!,
    stopSession: async (sessionId: string) => {
      await call("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {});
    },

    /** Counts one free message; the same id twice counts once. */
    async consumeMessage(messageId: string, source: "app" | "telegram") {
      try {
        await call("POST", "/v1/messages/consume", { messageId, source });
        return { allowed: true as const };
      } catch (error) {
        if (error instanceof CloudError && error.status === 402) return { allowed: false as const };
        throw error;
      }
    },

    search: async (query: string, numResults = 5) =>
      (await call<unknown>("POST", "/v1/proxy/search", { query, numResults })).data,

    /** Where the Composio MCP client points instead of connect.composio.dev with a vendor key. */
    composioMcpUrl: () => `${base}/v1/proxy/composio/mcp`,
  };
}

export type GenteCloud = ReturnType<typeof createGenteCloud>;

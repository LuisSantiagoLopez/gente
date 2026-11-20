// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Composio Connect as a managed connector: one consumer key reaches every Composio app over MCP,
// so the in-chat "Connect" card, the Connections screen and template apps work the same as with a
// project key. Connecting returns Composio's hosted sign-in link; the card waits for the account
// to turn active, then the bot carries on. Runs see three tools (find an action, read its inputs,
// run it), only for apps the person connected: Composio's pay-per-call "instant" apps and its
// code sandbox are never offered, so nothing is spent or run that the person did not connect.

import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
} from "@rakazo/adapter-kit";
import { deadlineSignal } from "@rakazo/core";
import { filterCatalog } from "../../../integrations/connector-catalog.js";
import { COMPOSIO_MULTI_EXECUTE_TOOL, composioSessionToolBatch } from "./composio-batch.js";
import { COMPOSIO_CONNECT_APPS, connectAppLogo } from "./composio-connect-apps.js";
import { sanitizeIntegrationError } from "./composio-connector.js";

export const COMPOSIO_CONNECT_ENDPOINT = "https://connect.composio.dev/mcp";
const SEARCH = "COMPOSIO_SEARCH_TOOLS";
const SCHEMAS = "COMPOSIO_GET_TOOL_SCHEMAS";
const MANAGE = "COMPOSIO_MANAGE_CONNECTIONS";

/** Short descriptions: the vendor's run to thousands of characters, which a local model pays for. */
const RUN_TOOLS: Record<string, { description: string; label: string }> = {
  [SEARCH]: {
    description:
      "Find the actions for a task in the user's connected apps. Call first. One query per action, in English, naming the app.",
    label: "Searching your apps",
  },
  [SCHEMAS]: {
    description:
      "Read the exact inputs of actions found by the search, when the search did not show them.",
    label: "Checking app details",
  },
  [COMPOSIO_MULTI_EXECUTE_TOOL]: {
    description:
      "Run actions found by the search, with their exact slugs and arguments. Batch only actions that do not depend on each other.",
    label: "Using your apps",
  },
};

/** Account states the person can only leave by reconnecting. */
const RECONNECT_STATUSES = new Set(["EXPIRED", "INACTIVE", "FAILED", "REVOKED"]);

type Account = { id: string; status: string };
type ToolkitResult = { accounts?: Account[]; redirect_url?: string; error?: string };
type McpTool = { name: string; inputSchema?: Record<string, unknown> };

export type ComposioConnectOptions = {
  /**
   * How calls are authorized: a Composio Connect consumer key on Santi's own Mac, or, for
   * customers, a Gente Cloud token for its proxy (one Composio session per Gente user).
   */
  auth: { consumerKey: string } | { bearer: () => Promise<string | undefined> };
  fetch?: typeof fetch;
  endpoint?: string;
  /** How long a call may take; Composio's own tools can run for a minute. */
  timeoutMs?: number;
};

export class ComposioConnectConnector implements ManagedConnectorProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private toolList?: Promise<McpTool[]>;
  private nextId = 1;
  /** The MCP session the server assigned, sent back on every call (the cloud proxy needs it). */
  private session?: Promise<string | undefined>;

  constructor(private readonly options: ComposioConnectOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? COMPOSIO_CONNECT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  describe() {
    return {
      id: "composio",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  async catalog(context: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    let apps = query
      ? filterCatalog([...COMPOSIO_CONNECT_APPS], query)
      : [...COMPOSIO_CONNECT_APPS];
    const wanted = query?.trim().toLowerCase();
    // An app outside the list still connects when asked for by its exact slug.
    if (apps.length === 0 && wanted && /^[a-z0-9_]{2,60}$/.test(wanted)) {
      apps = [{ slug: wanted, name: query?.trim() ?? wanted }];
    }
    const accounts = await this.accounts(
      apps.map((app) => app.slug),
      context.signal,
    );
    const items = apps.map((app) => ({
      connectorId: "composio",
      slug: app.slug,
      name: app.name,
      logo: connectAppLogo(app.slug),
      connected: (accounts.get(app.slug) ?? []).some((account) => account.status === "ACTIVE"),
      noAuth: false,
    }));
    return items;
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    const accounts = await this.accounts(this.knownSlugs(context), context.signal);
    return [...accounts]
      .filter(([, list]) => list.some((account) => account.status === "ACTIVE"))
      .map(([slug]) => slug);
  }

  async listConnectedRefs(context: AdapterContext): Promise<string[]> {
    return this.refsWhere(context, (status) => status === "ACTIVE");
  }

  async listReconnectRefs(context: AdapterContext): Promise<string[]> {
    return this.refsWhere(context, (status) => RECONNECT_STATUSES.has(status));
  }

  async needsReconnect(context: AdapterContext, externalId: string): Promise<boolean> {
    const list = (await this.accounts([externalId], context.signal)).get(externalId) ?? [];
    return (
      !list.some((account) => account.status === "ACTIVE") &&
      list.some((account) => RECONNECT_STATUSES.has(account.status))
    );
  }

  async connectionReady(context: AdapterContext, externalId: string): Promise<boolean> {
    const list = (await this.accounts([externalId], context.signal)).get(externalId) ?? [];
    return list.some((account) => account.status === "ACTIVE");
  }

  async begin(
    request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    const slug = request.provider.trim().toLowerCase();
    const result = (await this.manage([{ name: slug, action: "add" }], context.signal))[slug];
    if (!result?.redirect_url) {
      throw new Error(`Could not start connecting ${slug}`);
    }
    const account =
      result.accounts?.find((item) => item.status !== "ACTIVE") ?? result.accounts?.[0];
    return { authorizationUrl: result.redirect_url, state: account?.id ?? slug };
  }

  async complete(request: { state: string }): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    const slug = toolkitOfAccount(connectionRef);
    const list = (await this.accounts([slug], context.signal)).get(slug) ?? [];
    // A ref that is a bare app slug (an older row) removes that app's accounts.
    const targets = list.filter(
      (account) => account.id === connectionRef || connectionRef === slug,
    );
    for (const account of targets) {
      await this.manage([{ name: slug, action: "remove", account_id: account.id }], context.signal);
    }
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    if (connectedSlugs(context).length === 0) return [];
    const listed = await this.listTools(context.signal);
    return listed.flatMap((tool) => {
      const own = RUN_TOOLS[tool.name];
      if (!own) return [];
      return [
        {
          name: tool.name,
          description: own.description,
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
          label: own.label,
          batch: composioSessionToolBatch(tool.name),
          route: { connectorId: "composio", toolName: tool.name },
        },
      ];
    });
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    const tool = call.route?.toolName ?? call.tool;
    if (!RUN_TOOLS[tool]) {
      yield { type: "error", message: "This app action is not available." };
      return;
    }
    const connected = connectedSlugs(context);
    if (tool === COMPOSIO_MULTI_EXECUTE_TOOL) {
      const outside = innerSlugs(call.args).find((slug) => !usesConnectedApp(slug, connected));
      if (outside) {
        yield {
          type: "error",
          message: `${outside} belongs to an app that is not connected. Connect it first with connect_app.`,
        };
        return;
      }
    }
    try {
      const result = await this.rpc(
        "tools/call",
        { name: tool, arguments: call.args ?? {} },
        context.signal,
      );
      const text = mcpText(result);
      const parsed = parseJson(text);
      if (isRecord(result) && result.isError) {
        yield { type: "error", message: sanitizeIntegrationError(errorText(parsed) ?? text) };
        return;
      }
      if (isRecord(parsed) && parsed.successful === false) {
        yield {
          type: "error",
          message: sanitizeIntegrationError(errorText(parsed) ?? "The app action failed."),
        };
        return;
      }
      yield {
        type: "result",
        data: tool === SEARCH ? slimSearch(parsed, connected) : (parsed ?? text),
      };
    } catch (error) {
      yield { type: "error", message: sanitizeIntegrationError(error) };
    }
  }

  private knownSlugs(context: AdapterContext): string[] {
    return [
      ...new Set([...COMPOSIO_CONNECT_APPS.map((app) => app.slug), ...connectedSlugs(context)]),
    ];
  }

  private async refsWhere(context: AdapterContext, keep: (status: string) => boolean) {
    const accounts = await this.accounts(this.knownSlugs(context), context.signal);
    return [...accounts.values()]
      .flat()
      .filter((account) => keep(account.status))
      .map((a) => a.id);
  }

  private async accounts(slugs: string[], signal: AbortSignal): Promise<Map<string, Account[]>> {
    const results = await this.manage(
      slugs.map((name) => ({ name, action: "list" })),
      signal,
    );
    return new Map(
      slugs.map((slug) => [
        slug,
        (results[slug]?.accounts ?? []).map((account) => ({
          id: String(account.id),
          status: String(account.status).toUpperCase(),
        })),
      ]),
    );
  }

  private async manage(
    toolkits: Array<{ name: string; action: string; account_id?: string }>,
    signal: AbortSignal,
  ): Promise<Record<string, ToolkitResult>> {
    const result = await this.rpc("tools/call", { name: MANAGE, arguments: { toolkits } }, signal);
    const parsed = parseJson(mcpText(result));
    if (!isRecord(parsed) || parsed.successful === false) {
      throw new Error(
        sanitizeIntegrationError(errorText(parsed) ?? "Connections could not be read"),
      );
    }
    const data = isRecord(parsed.data) ? parsed.data : {};
    return (isRecord(data.results) ? data.results : {}) as Record<string, ToolkitResult>;
  }

  private listTools(signal: AbortSignal): Promise<McpTool[]> {
    this.toolList ??= this.rpc("tools/list", {}, signal).then((result) =>
      isRecord(result) && Array.isArray(result.tools) ? (result.tools as McpTool[]) : [],
    );
    // A failed listing is tried again next time instead of being remembered.
    this.toolList.catch(() => {
      this.toolList = undefined;
    });
    return this.toolList;
  }

  private async headers(): Promise<Record<string, string>> {
    const base = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const { auth } = this.options;
    if ("consumerKey" in auth) return { ...base, "x-consumer-api-key": auth.consumerKey };
    const token = await auth.bearer();
    if (!token) throw new Error("Sign in to Gente to use your apps");
    return { ...base, authorization: `Bearer ${token}` };
  }

  /** Opens the MCP session once (initialize, then initialized), as the protocol asks. */
  private openSession(signal: AbortSignal): Promise<string | undefined> {
    this.session ??= (async () => {
      const response = await this.post(
        {
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "gente", version: "1" },
          },
        },
        undefined,
        signal,
      );
      const id = response.headers.get("mcp-session-id") ?? undefined;
      await response.text();
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, id, signal).then(
        (sent) => sent.text(),
      );
      return id;
    })();
    // A failed open is tried again next time instead of being remembered.
    this.session.catch(() => {
      this.session = undefined;
    });
    return this.session;
  }

  private async post(body: unknown, session: string | undefined, signal: AbortSignal) {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { ...(await this.headers()), ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(body),
      signal: deadlineSignal(this.timeoutMs, signal),
    });
    if (!response.ok) throw new Error(`Your apps did not answer (${response.status})`);
    return response;
  }

  private async rpc(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const session = await this.openSession(signal);
    const response = await this.post(
      { jsonrpc: "2.0", id: this.nextId++, method, params },
      session,
      signal,
    ).catch((error: unknown) => {
      // An expired session is opened again on the next call.
      this.session = undefined;
      throw error;
    });
    const message = parseRpcBody(await response.text());
    if (!message) throw new Error("Your apps sent an answer Gente could not read");
    if (isRecord(message.error)) {
      throw new Error(String(message.error.message ?? "Your apps refused the request"));
    }
    return message.result;
  }
}

/** A JSON body, or the last JSON-RPC message of a server-sent event stream. */
export function parseRpcBody(body: string): Record<string, unknown> | undefined {
  const direct = parseJson(body);
  if (isRecord(direct)) return direct;
  const events = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => parseJson(line.slice(5).trim()))
    .filter(isRecord);
  return events.at(-1);
}

function connectedSlugs(context: AdapterContext): string[] {
  const rows =
    context.connectedConnections?.filter((row) => row.connectorId === "composio") ??
    (context.connectedProviders ?? []).map((externalId) => ({ externalId }));
  return [...new Set(rows.map((row) => row.externalId.toLowerCase()))];
}

/** Account ids read `<toolkit>_<words>`; toolkit slugs may hold underscores themselves. */
function toolkitOfAccount(ref: string): string {
  const known = COMPOSIO_CONNECT_APPS.map((app) => app.slug)
    .filter((slug) => ref === slug || ref.startsWith(`${slug}_`))
    .sort((a, b) => b.length - a.length)[0];
  return known ?? ref.replace(/_[^_]*$/, "");
}

function innerSlugs(args: Record<string, unknown> | undefined): string[] {
  const tools = Array.isArray(args?.tools) ? args.tools : [];
  return tools.map((item) => (isRecord(item) ? String(item.tool_slug ?? "") : "")).filter(Boolean);
}

/** `GMAIL_FETCH_EMAILS` belongs to `gmail`; `GOOGLE_BUSINESS_PROFILE_X` to `google_business_profile`. */
export function usesConnectedApp(toolSlug: string, connected: readonly string[]): boolean {
  const upper = toolSlug.toUpperCase();
  return connected.some((slug) => upper.startsWith(`${slug.toUpperCase()}_`));
}

/**
 * Keep what a model needs from a search (actions, inputs, plan, pitfalls, which apps are
 * connected) and drop code samples and pay-per-call offers, which run to many thousands of tokens.
 */
export function slimSearch(parsed: unknown, connected: readonly string[]): unknown {
  if (!isRecord(parsed) || !isRecord(parsed.data)) return parsed;
  const data = parsed.data;
  const results = Array.isArray(data.results) ? data.results.filter(isRecord) : [];
  const statuses = Array.isArray(data.toolkit_connection_statuses)
    ? data.toolkit_connection_statuses.filter(isRecord)
    : [];
  return {
    session: isRecord(data.session) ? data.session.id : undefined,
    now_utc: isRecord(data.time_info) ? data.time_info.current_time_utc : undefined,
    results: results.map((result) => ({
      use_case: result.use_case,
      actions: result.primary_tool_slugs,
      related: result.related_tool_slugs,
      plan: result.recommended_plan_steps,
      pitfalls: result.known_pitfalls,
    })),
    apps: statuses.map((status) => {
      const slug = String(status.toolkit ?? "");
      return { app: slug, connected: connected.includes(slug.toLowerCase()) };
    }),
    next: searchNext(
      statuses.map((status) => String(status.toolkit ?? "")),
      connected,
    ),
    inputs: isRecord(data.tool_schemas)
      ? Object.fromEntries(
          Object.entries(data.tool_schemas).map(([slug, schema]) => [
            slug,
            isRecord(schema) ? schema.input_schema : schema,
          ]),
        )
      : undefined,
  };
}

/**
 * What to do after a search. A search that does not name an app can land on an obscure one; when
 * the person has apps connected, steer back to those before offering to connect something new.
 */
export function searchNext(found: readonly string[], connected: readonly string[]): string {
  const hit = found.filter((slug) => connected.includes(slug.toLowerCase()));
  if (hit.length > 0) return `Use the actions of the connected apps: ${hit.join(", ")}.`;
  if (connected.length > 0) {
    return `None of these apps is connected. Connected: ${connected.join(", ")}. Search again naming one of those apps. Only if none can do the task, call connect_app for the app the user would expect, and wait.`;
  }
  return "No app here is connected. Call connect_app for the app the user would expect, and wait.";
}

function mcpText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function errorText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.error === "string" && value.error) return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

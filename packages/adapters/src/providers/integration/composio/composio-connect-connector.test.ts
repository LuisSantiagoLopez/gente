import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  ComposioConnectConnector,
  parseRpcBody,
  searchNext,
  slimSearch,
  usesConnectedApp,
} from "./composio-connect-connector.js";

type Account = { id: string; status: string };

/** A stateful stand-in for the Connect MCP endpoint: accounts per app, SSE answers. */
function fakeConnect(initial: Record<string, Account[]> = {}) {
  const accounts = new Map(Object.entries(initial));
  const calls: Array<{ method: string; params: Record<string, unknown>; key: string | null }> = [];
  let added = 0;
  const answer = (id: unknown, result: unknown) =>
    new Response(
      `: connected\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    calls.push({
      method: body.method,
      params: body.params,
      key: headers.get("x-consumer-api-key"),
    });
    if (body.method === "tools/list") {
      return answer(body.id, {
        tools: [
          "COMPOSIO_SEARCH_TOOLS",
          "COMPOSIO_GET_TOOL_SCHEMAS",
          "COMPOSIO_MULTI_EXECUTE_TOOL",
          "COMPOSIO_MANAGE_CONNECTIONS",
          "COMPOSIO_REMOTE_WORKBENCH",
          "COMPOSIO_PROXY_EXECUTE",
        ].map((name) => ({ name, description: "x".repeat(4000), inputSchema: { type: "object" } })),
      });
    }
    const { name, arguments: args } = body.params;
    if (name === "COMPOSIO_MANAGE_CONNECTIONS") {
      const results: Record<string, unknown> = {};
      for (const item of args.toolkits as Array<{
        name: string;
        action: string;
        account_id?: string;
      }>) {
        const list = accounts.get(item.name) ?? [];
        if (item.action === "add") {
          const account = { id: `${item.name}_new-${++added}`, status: "INITIATED" };
          accounts.set(item.name, [...list, account]);
          results[item.name] = {
            redirect_url: `https://connect.example.test/link/${account.id}`,
            accounts: [account],
          };
        } else if (item.action === "remove") {
          accounts.set(
            item.name,
            list.filter((account) => account.id !== item.account_id),
          );
          results[item.name] = { accounts: accounts.get(item.name) };
        } else {
          results[item.name] = { accounts: list };
        }
      }
      return answer(body.id, text({ successful: true, data: { results } }));
    }
    if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      return answer(body.id, text({ successful: true, data: { results: [{ ok: true }] } }));
    }
    return answer(body.id, text({ successful: false, error: "unknown tool" }));
  }) as typeof fetch;
  return { fetchImpl, accounts, calls };
}

function context(connected: string[] = []): AdapterContext {
  return {
    operationId: "op",
    traceId: "trace",
    spaceId: "space",
    userId: "user",
    signal: new AbortController().signal,
    connectedConnections: connected.map((externalId) => ({
      id: `row-${externalId}`,
      connectorId: "composio",
      externalId,
      displayName: externalId,
    })),
  };
}

async function collect(events: AsyncIterable<ConnectorEvent>) {
  const out: ConnectorEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("ComposioConnectConnector", () => {
  it("sends the consumer key and lists the money apps with their connection state", async () => {
    const fake = fakeConnect({ gmail: [{ id: "gmail_a", status: "ACTIVE" }] });
    const connector = new ComposioConnectConnector({ key: "ck_test", fetch: fake.fetchImpl });
    const catalog = await connector.catalog(context());
    expect(catalog.find((item) => item.slug === "gmail")).toMatchObject({
      connectorId: "composio",
      name: "Gmail",
      connected: true,
    });
    expect(catalog.find((item) => item.slug === "hubspot")?.connected).toBe(false);
    expect(fake.calls.every((call) => call.key === "ck_test")).toBe(true);
    // One request lists every app.
    expect(fake.calls).toHaveLength(1);
  });

  it("filters by name and still offers an unlisted app by its exact slug", async () => {
    const connector = new ComposioConnectConnector({ key: "k", fetch: fakeConnect().fetchImpl });
    expect((await connector.catalog(context(), "hubsp")).map((item) => item.slug)).toEqual([
      "hubspot",
    ]);
    expect((await connector.catalog(context(), "freshbooks")).map((item) => item.slug)).toEqual([
      "freshbooks",
    ]);
    expect(await connector.catalog(context(), "no such app!")).toEqual([]);
  });

  it("connects through the hosted link and is ready once the account is active", async () => {
    const fake = fakeConnect();
    const connector = new ComposioConnectConnector({ key: "k", fetch: fake.fetchImpl });
    const started = await connector.begin(
      { provider: "hubspot", redirectUrl: "https://app.test/back" },
      context(),
    );
    expect(started.authorizationUrl).toBe("https://connect.example.test/link/hubspot_new-1");
    expect(started.state).toBe("hubspot_new-1");
    expect(await connector.connectionReady(context(), "hubspot")).toBe(false);
    fake.accounts.set("hubspot", [{ id: "hubspot_new-1", status: "ACTIVE" }]);
    expect(await connector.connectionReady(context(), "hubspot")).toBe(true);
    expect(await connector.complete({ state: started.state })).toEqual({
      connectionRef: "hubspot_new-1",
    });
    expect(await connector.listConnectedExternalIds(context())).toEqual(["hubspot"]);
  });

  it("reports expired accounts for reconnecting and removes the account on revoke", async () => {
    const fake = fakeConnect({
      google_business_profile: [{ id: "google_business_profile_old", status: "EXPIRED" }],
      gmail: [{ id: "gmail_a", status: "ACTIVE" }],
    });
    const connector = new ComposioConnectConnector({ key: "k", fetch: fake.fetchImpl });
    expect(await connector.listReconnectRefs(context())).toEqual(["google_business_profile_old"]);
    expect(await connector.needsReconnect(context(), "google_business_profile")).toBe(true);
    expect(await connector.needsReconnect(context(), "gmail")).toBe(false);
    await connector.revoke("google_business_profile_old", context());
    expect(fake.accounts.get("google_business_profile")).toEqual([]);
    expect(fake.accounts.get("gmail")).toHaveLength(1);
  });

  it("offers only the find, inputs and run tools, with short descriptions, once an app is connected", async () => {
    const connector = new ComposioConnectConnector({ key: "k", fetch: fakeConnect().fetchImpl });
    expect(await connector.discoverTools(context())).toEqual([]);
    const tools = await connector.discoverTools(context(["gmail"]));
    expect(tools.map((tool) => tool.name)).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      "COMPOSIO_GET_TOOL_SCHEMAS",
      "COMPOSIO_MULTI_EXECUTE_TOOL",
    ]);
    expect(tools.every((tool) => tool.description.length < 200)).toBe(true);
    // Approvals judge each inner action, never the batch tool.
    expect(tools[2]?.batch).toMatchObject({ items: "tools", action: "tool_slug" });
  });

  it("refuses actions from apps the person did not connect, including pay-per-call ones", async () => {
    const connector = new ComposioConnectConnector({ key: "k", fetch: fakeConnect().fetchImpl });
    const refused = await collect(
      connector.execute(
        {
          tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
          executionId: "e1",
          args: {
            tools: [
              { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} },
              { tool_slug: "GOOGLE_MAPS_TEXT_SEARCH", arguments: {} },
            ],
          },
        },
        context(["gmail"]),
      ),
    );
    expect(refused).toEqual([
      expect.objectContaining({ type: "error", message: expect.stringContaining("GOOGLE_MAPS") }),
    ]);
    const ran = await collect(
      connector.execute(
        {
          tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
          executionId: "e2",
          args: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] },
        },
        context(["gmail"]),
      ),
    );
    expect(ran[0]?.type).toBe("result");
    const sandbox = await collect(
      connector.execute(
        { tool: "COMPOSIO_REMOTE_WORKBENCH", executionId: "e3", args: {} },
        context(["gmail"]),
      ),
    );
    expect(sandbox[0]?.type).toBe("error");
  });
});

describe("Connect helpers", () => {
  it("steers a search back to connected apps before offering a new one", () => {
    expect(searchNext(["sentfromai"], ["gmail", "googlecalendar"])).toContain(
      "Connected: gmail, googlecalendar. Search again naming one of those apps.",
    );
    expect(searchNext(["gmail", "outlook"], ["gmail"])).toBe(
      "Use the actions of the connected apps: gmail.",
    );
    expect(searchNext(["hubspot"], [])).toContain("connect_app");
  });

  it("reads plain JSON and server-sent event bodies", () => {
    expect(parseRpcBody('{"id":1,"result":2}')).toEqual({ id: 1, result: 2 });
    expect(parseRpcBody(': hi\n\nevent: message\ndata: {"id":1,"result":3}\n\n')).toEqual({
      id: 1,
      result: 3,
    });
    expect(parseRpcBody("nope")).toBeUndefined();
  });

  it("matches an action to its app, including apps with underscores", () => {
    expect(
      usesConnectedApp("GOOGLE_BUSINESS_PROFILE_GET_REVIEWS", ["google_business_profile"]),
    ).toBe(true);
    expect(usesConnectedApp("GMAILX_SEND", ["gmail"])).toBe(false);
    expect(usesConnectedApp("GOOGLESHEETS_VALUES_GET", ["gmail"])).toBe(false);
  });

  it("slims a search to actions, plan, inputs and connection state", () => {
    const slim = slimSearch(
      {
        successful: true,
        data: {
          results: [
            {
              use_case: "fetch emails",
              primary_tool_slugs: ["GMAIL_FETCH_EMAILS"],
              reference_workbench_snippets: [{ code: "x".repeat(5000) }],
            },
          ],
          toolkit_connection_statuses: [
            { toolkit: "gmail", has_active_connection: true },
            { toolkit: "firecrawl", has_active_connection: true, instant_account: { prices: {} } },
          ],
          tool_schemas: {
            GMAIL_FETCH_EMAILS: { input_schema: { type: "object" }, description: "d" },
          },
          session: { id: "abc" },
        },
      },
      ["gmail"],
    );
    expect(JSON.stringify(slim)).not.toContain("xxxxx");
    expect(JSON.stringify(slim)).not.toContain("prices");
    expect(slim).toMatchObject({
      session: "abc",
      results: [{ actions: ["GMAIL_FETCH_EMAILS"] }],
      apps: [
        { app: "gmail", connected: true },
        { app: "firecrawl", connected: false },
      ],
      next: expect.stringContaining("gmail"),
      inputs: { GMAIL_FETCH_EMAILS: { type: "object" } },
    });
  });
});

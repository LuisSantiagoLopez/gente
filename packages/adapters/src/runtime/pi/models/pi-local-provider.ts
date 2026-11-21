import type { Model, MutableModels, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { bestEffort } from "@rakazo/logging";
import type { Dispatcher } from "undici";
import { Agent, EnvHttpProxyAgent } from "undici";
import { sanitizeChatBody } from "../../../models/chat-request-sanitizer.js";
import { pacerTokensPerMinute } from "../../../models/endpoints/token-pacer.js";
import { declaredVisionModelIds, inputModalities } from "../../../models/model-modalities.js";
import { fetchPairedWithDispatcher } from "../../../network/undici-fetch.js";
import { MODEL_STREAM_AGENT_TIMEOUTS } from "../pi-runtime-limits.js";
import { splitLeadingThinkBlock } from "../stream/pi-think-tags.js";
import { burrowFastChatInit, guardsActionClaims } from "./burrow-fast-chat.js";
import {
  guardActionClaims,
  toolRanThisTurn,
  withHonestyRule,
  withUseToolsNote,
} from "./gente-honest-actions.js";
import { filterTextToolCalls, offeredTools } from "./gente-text-tool-calls.js";
import { cachedAnswerResponse, planWebAnswer, withPreface } from "./gente-web-answer.js";
import { LOCAL_PROVIDER_ID, localModelIds, localModelsApiKey } from "./pi-local-provider-id.js";

/** Reasoning effort names for an OpenAI-style chat completions server that accepts them. */
export const REASONING_THINKING_LEVELS: Model<"openai-completions">["thinkingLevelMap"] = {
  off: "none",
  xhigh: "xhigh",
  max: "max",
};

/**
 * Local OpenAI-compatible model server (Ollama, LM Studio, llama.cpp, MLX).
 * Without RAKAZO_LOCAL_MODELS_API_KEY the server is keyless, but `resolve` returns
 * a placeholder because Models hides providers with no resolvable auth.
 */
export { LOCAL_PROVIDER_ID };

/** Model ids the local server serves with vision, declared by the operator. */
export const LOCAL_VISION_MODELS_ENV = "RAKAZO_LOCAL_VISION_MODELS";

export function localVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(LOCAL_VISION_MODELS_ENV);
}

/** Model ids the local server serves with OpenAI-style `reasoning_effort`, declared by the operator. */
export const LOCAL_REASONING_MODELS_ENV = "RAKAZO_LOCAL_REASONING_MODELS";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;

export function localBaseUrl(): string {
  const value = process.env.RAKAZO_LOCAL_MODELS_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  return value;
}

/** Throws instead of `Number(x) || default`, which would swallow a typo or accept a negative window. */
function tokenLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

function localModel(id: string): Model<"openai-completions"> {
  // Same comma-separated id list as the vision opt-in.
  const reasoning = declaredVisionModelIds(LOCAL_REASONING_MODELS_ENV).has(id);
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: localBaseUrl(),
    reasoning,
    compat: reasoning
      ? { supportsDeveloperRole: false, supportsReasoningEffort: true, thinkingFormat: "openai" }
      : { supportsDeveloperRole: false, supportsReasoningEffort: false },
    ...(reasoning ? { thinkingLevelMap: { ...REASONING_THINKING_LEVELS } } : {}),
    input: inputModalities(localVisionModelIds().has(id)),
    // Runs on the operator's own hardware, so there is nothing to bill.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: tokenLimit("RAKAZO_LOCAL_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW),
    maxTokens: tokenLimit("RAKAZO_LOCAL_MAX_TOKENS", DEFAULT_MAX_TOKENS),
  };
}

/**
 * Gente: a model on this computer answers without thinking unless the person picks a level.
 * Thinking first made a "hey" take 11 to 20 seconds instead of under one.
 */
export function startsWithoutThinking(model: { provider: string }): boolean {
  return model.provider === LOCAL_PROVIDER_ID && process.env.BURROW_FAST_CHAT === "on";
}

let localDispatcher: Dispatcher | undefined;

/** Node's built-in fetch, which local servers used before, honors HTTP(S)_PROXY only when asked to. */
function nodeFetchUsesEnvProxy(): boolean {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS?.split(/\s+/) ?? [])];
  return process.env.NODE_USE_ENV_PROXY === "1" || flags.includes("--use-env-proxy");
}

/** A queued local server can stay silent for minutes; the runtime's own timeouts bound it. */
function localModelFetch(baseFetch?: typeof globalThis.fetch): typeof globalThis.fetch {
  localDispatcher ??= nodeFetchUsesEnvProxy()
    ? new EnvHttpProxyAgent(MODEL_STREAM_AGENT_TIMEOUTS)
    : new Agent(MODEL_STREAM_AGENT_TIMEOUTS);
  const dispatcher = localDispatcher;
  const paired = fetchPairedWithDispatcher(baseFetch);
  // Gente: the last step before every request leaves: a shape every local chat template accepts.
  const transport: typeof globalThis.fetch = (input, init) =>
    paired(
      input,
      typeof init?.body === "string" ? { ...init, body: sanitizeChatBody(init.body) } : init,
    );
  // Gente (modified from Rakazo): quick chat without thinking, and a saved prefix to prewarm.
  return async (input, init) => {
    // Gente: a question that plainly needs the web becomes one model call with fresh sources.
    if (process.env.BURROW_FAST_CHAT === "on" && typeof init?.body === "string") {
      const plan = await bestEffort("plan a one-call web answer", planWebAnswer(init.body));
      if (plan?.kind === "cached") return cachedAnswerResponse(plan.answer);
      if (plan?.kind === "ask") {
        const response = await transport(input, {
          ...init,
          body: plan.body,
          dispatcher,
        } as RequestInit & { dispatcher: Dispatcher });
        return withPreface(response, plan.preface, plan.cacheKey);
      }
    }
    const sent = burrowFastChatInit(init);
    const response = await transport(input, { ...sent, dispatcher } as RequestInit & {
      dispatcher: Dispatcher;
    });
    // Gente: a tool call the model wrote as text becomes a real call, or is removed; never shown.
    if (process.env.BURROW_FAST_CHAT !== "on" || typeof sent?.body !== "string") return response;
    const known = offeredTools(parseBody(init?.body)).map((tool) => tool.name);
    const tools = offeredTools(parseBody(sent.body));
    const filtered = (reply: Response, body: string) =>
      known.length === 0 && tools.length === 0
        ? reply
        : filterTextToolCalls(reply, {
            tools,
            known,
            retry: () =>
              transport(input, {
                ...sent,
                body: withFormatNote(body),
                dispatcher,
              } as RequestInit & { dispatcher: Dispatcher }),
          });
    const first = await filtered(response, sent.body as string);
    // Gente: a reply that says it did something no tool did is asked again, with its tools.
    const original = parseBody(init?.body) as { messages?: unknown[] } | null;
    const messages = (original?.messages ?? []) as Parameters<typeof guardsActionClaims>[0];
    if (known.length === 0 || toolRanThisTurn(messages) || !guardsActionClaims(messages)) {
      return first;
    }
    return guardActionClaims(first, async () => {
      // Small talk went without tools; the retry gets the full request with every tool.
      const base = tools.length > 0 ? (sent.body as string) : (init?.body as string);
      const parsed = parseBody(base) as { messages?: Parameters<typeof withHonestyRule>[0] };
      if (parsed?.messages) parsed.messages = withHonestyRule(parsed.messages);
      const body = withUseToolsNote(JSON.stringify(parsed ?? {}));
      const again = await transport(input, { ...sent, body, dispatcher } as RequestInit & {
        dispatcher: Dispatcher;
      });
      return filtered(again, body);
    });
  };
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The retry after a tool call written as text: the same request with a one-line reminder. */
function withFormatNote(body: string): string {
  const parsed = parseBody(body) as {
    messages?: Array<{ role?: string; content?: unknown }>;
  } | null;
  const last = parsed?.messages?.at(-1);
  if (!parsed?.messages || !last || typeof last.content !== "string") return body;
  last.content +=
    "\n\n<format_note>Call a tool only through tool calling, never by writing its name or arguments in your reply. Otherwise answer in plain words.</format_note>";
  return JSON.stringify(parsed);
}

function localApi(): ProviderStreams {
  const api = openAICompletionsApi();
  return {
    stream: (model, context, options) =>
      splitLeadingThinkBlock(
        api.stream(model, context, { ...options, fetch: localModelFetch(options?.fetch) }),
      ),
    streamSimple: (model, context, options) =>
      splitLeadingThinkBlock(
        api.streamSimple(model, context, { ...options, fetch: localModelFetch(options?.fetch) }),
      ),
  };
}

export function localProvider(): Provider | undefined {
  const ids = localModelIds();
  if (!ids.length) return undefined;
  // Fail on a bad pacing limit with the other token limits, not on the first model call.
  pacerTokensPerMinute(LOCAL_PROVIDER_ID);
  return createProvider({
    id: LOCAL_PROVIDER_ID,
    name: "Local (Ollama / LM Studio)",
    baseUrl: localBaseUrl(),
    auth: {
      apiKey: {
        name: "Local model server",
        resolve: async () => ({
          auth: { apiKey: localModelsApiKey() ?? "local", baseUrl: localBaseUrl() },
          source: "local model server",
        }),
      },
    },
    models: ids.map(localModel),
    api: localApi(),
  });
}

export function registerLocalProvider(models: MutableModels): MutableModels {
  const provider = localProvider();
  if (provider) models.setProvider(provider);
  return models;
}

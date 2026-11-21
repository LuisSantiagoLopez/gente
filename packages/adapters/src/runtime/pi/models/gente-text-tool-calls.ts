// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// A local model sometimes writes a tool call as plain text instead of calling the tool, for
// example `ask_user: "¿Qué quieres que haga?"` followed by a quoted list. Shown as chat, that is
// tool syntax in front of the person. This filter sits on the local model's reply stream:
//   - a line that starts like a tool call is held back until it can be read,
//   - when it parses and the tool is offered in this request, it becomes a real tool call
//     (so ask_user shows its card),
//   - when it can't be used, it is removed; the request is retried once with a short note when
//     nothing was shown yet, and otherwise any normal text around it is kept.
// Everything else streams through unchanged.

type JsonSchema = {
  type?: string;
  properties?: Record<string, { type?: string }>;
  required?: string[];
};
export interface OfferedTool {
  name: string;
  parameters?: JsonSchema;
}
export interface TextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
export interface ReadTextToolCalls {
  calls: TextToolCall[];
  /** Normal text around the tool syntax, kept for the person. */
  text: string;
  /** Tool syntax was found but could not be turned into a call. */
  unusable: boolean;
  /** Any tool syntax was found at all. */
  found: boolean;
}

/** The tools a chat-completions request offers, with their parameter schemas. */
export function offeredTools(body: unknown): OfferedTool[] {
  const tools = (body as { tools?: unknown[] } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    const fn = (tool as { function?: { name?: unknown; parameters?: JsonSchema } }).function;
    return typeof fn?.name === "string" ? [{ name: fn.name, parameters: fn.parameters }] : [];
  });
}

/** How often held text sends an empty chunk so the stream does not look idle. */
const KEEPALIVE_MS = 5_000;

const QWEN_CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const XML_FUNCTION = /^<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/;
const XML_PARAMETER = /<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g;

/**
 * `<function=name><parameter=key>value</parameter></function>`, the call format newer Qwen chat
 * templates teach, as `{ name, arguments }`. A value that reads as JSON (a number, list, object)
 * keeps its type; anything else is text.
 */
function xmlFunctionCall(
  inner: string,
): { name: string; arguments: Record<string, unknown> } | null {
  const match = XML_FUNCTION.exec(inner);
  if (!match) return null;
  const args: Record<string, unknown> = {};
  for (const [, key, raw] of match[2]!.matchAll(XML_PARAMETER)) {
    const value = raw!.trim();
    try {
      args[key!] = /^[[{\d"-]|^(true|false|null)$/.test(value) ? JSON.parse(value) : value;
    } catch {
      args[key!] = value;
    }
  }
  return { name: match[1]!, arguments: args };
}
const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)]|[A-Da-d][.)])\s+(.+?)\s*$/;

const stripQuotes = (value: string) =>
  value
    .trim()
    .replace(/^["'“”‘’«]+|["'“”‘’»]+[.,;]?$/g, "")
    .trim();

function startsLikeName(line: string, names: readonly string[]): string | null {
  const text = line.trimStart().replace(/^`+/, "");
  for (const name of names) {
    if (text.startsWith(name) && /^\s*[:(]/.test(text.slice(name.length))) return name;
  }
  return null;
}

/** A line that starts like tool syntax: hold it back until the reply can be read. */
export function startsToolSyntax(line: string, names: readonly string[]): boolean {
  const text = line.trimStart().replace(/^`+/, "");
  return (
    text.startsWith("<tool_call>") || text.startsWith("{") || startsLikeName(line, names) !== null
  );
}

/** The start of a line that could still turn into tool syntax once more text arrives. */
export function mayStartToolSyntax(partial: string, names: readonly string[]): boolean {
  const text = partial.trimStart().replace(/^`+/, "");
  if (text === "") return true;
  if ("<tool_call>".startsWith(text) || text.startsWith("<tool_call>") || text.startsWith("{"))
    return true;
  return names.some(
    (name) =>
      name.startsWith(text) || (text.startsWith(name) && /^\s*$/.test(text.slice(name.length))),
  );
}

/** The first balanced JSON object at the start of `text`, and what follows it. */
function leadingJson(text: string): { value: unknown; rest: string } | null {
  const start = text.indexOf("{");
  if (start !== 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return { value: JSON.parse(text.slice(0, i + 1)), rest: text.slice(i + 1) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Arguments from text: a JSON object as is; a string and a list mapped onto the tool's schema. */
function argumentsFor(
  tool: OfferedTool | undefined,
  value: { object?: Record<string, unknown>; string?: string; list?: string[] },
): Record<string, unknown> | null {
  if (value.object) return value.object;
  const properties = Object.entries(tool?.parameters?.properties ?? {});
  const required = tool?.parameters?.required ?? [];
  const args: Record<string, unknown> = {};
  const stringKey =
    properties.find(([key, prop]) => prop.type === "string" && required.includes(key))?.[0] ??
    properties.find(([, prop]) => prop.type === "string")?.[0];
  if (value.string !== undefined && stringKey) args[stringKey] = value.string;
  const listKey = properties.find(([, prop]) => prop.type === "array")?.[0];
  if (value.list?.length && listKey) args[listKey] = value.list;
  return Object.keys(args).length ? args : null;
}

function usable(
  tool: OfferedTool | undefined,
  args: Record<string, unknown> | null,
): args is Record<string, unknown> {
  if (!tool || !args) return false;
  return (tool.parameters?.required ?? []).every(
    (key) => args[key] !== undefined && args[key] !== "",
  );
}

function callFromObject(
  value: unknown,
  tools: readonly OfferedTool[],
): { name: string; args: Record<string, unknown> | null } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; arguments?: unknown; parameters?: unknown };
  if (typeof raw.name !== "string") return null;
  let args = raw.arguments ?? raw.parameters;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = null;
    }
  }
  const tool = tools.find((candidate) => candidate.name === raw.name);
  return {
    name: raw.name,
    args: args && typeof args === "object" && tool ? (args as Record<string, unknown>) : null,
  };
}

/**
 * Reads tool calls written as text. `tools` are the tools this request can call; `known` are tool
 * names to remove even when they can't be called here (a slim request offers none).
 */
export function readTextToolCalls(
  text: string,
  tools: readonly OfferedTool[],
  known: readonly string[] = tools.map((tool) => tool.name),
): ReadTextToolCalls {
  const names = [...new Set([...tools.map((tool) => tool.name), ...known])].sort(
    (a, b) => b.length - a.length,
  );
  const calls: TextToolCall[] = [];
  let unusable = false;
  let found = false;
  const add = (name: string, args: Record<string, unknown> | null) => {
    found = true;
    const tool = tools.find((candidate) => candidate.name === name);
    if (usable(tool, args)) calls.push({ name, arguments: args });
    else unusable = true;
  };

  // Qwen-style <tool_call>{...}</tool_call>, or its XML form with <function=...> blocks.
  let remaining = text.replace(QWEN_CALL, (_whole, inner: string) => {
    const xml = xmlFunctionCall(inner.trim());
    const parsed = xml ? { value: xml } : leadingJson(inner.trim());
    const call = callFromObject(parsed?.value, tools);
    if (call) add(call.name, call.args);
    else {
      found = true;
      unusable = true;
    }
    return "";
  });

  const kept: string[] = [];
  const lines = remaining.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart().replace(/^`+/, "");
    // A bare JSON object naming a tool.
    if (trimmed.startsWith("{")) {
      const json = leadingJson(lines.slice(i).join("\n").trimStart().replace(/^`+/, ""));
      const call = callFromObject(json?.value, tools);
      if (json && call && names.includes(call.name)) {
        add(call.name, call.args);
        const consumed = lines.slice(i).join("\n").trimStart().length - json.rest.length;
        // Skip the lines the JSON object used.
        let used = 0;
        let j = i;
        while (j < lines.length && used < consumed) used += lines[j++]!.length + 1;
        i = j - 1;
        const tail = json.rest.replace(/^`+/, "").trim();
        if (tail) kept.push(tail);
        continue;
      }
      kept.push(line);
      continue;
    }
    const name = startsLikeName(line, names);
    if (!name) {
      kept.push(line);
      continue;
    }
    let rest = trimmed.slice(name.length).trimStart();
    const tool = tools.find((candidate) => candidate.name === name);
    if (rest.startsWith("(")) {
      // name({...}) or name("...")
      const inner = rest
        .slice(1)
        .replace(/\)\s*`*\s*$/, "")
        .trim();
      const json = leadingJson(inner);
      if (json && json.value && typeof json.value === "object")
        add(name, argumentsFor(tool, { object: json.value as Record<string, unknown> }));
      else add(name, argumentsFor(tool, { string: stripQuotes(inner) }));
      continue;
    }
    rest = rest.slice(1).trim(); // after ":"
    const json = leadingJson(rest.startsWith("{") ? [rest, ...lines.slice(i + 1)].join("\n") : "");
    if (json && json.value && typeof json.value === "object") {
      add(name, argumentsFor(tool, { object: json.value as Record<string, unknown> }));
      // Skip the lines the object spans.
      let used = rest.length + 1;
      const consumed = [rest, ...lines.slice(i + 1)].join("\n").length - json.rest.length;
      let j = i + 1;
      while (j < lines.length && used < consumed) used += lines[j++]!.length + 1;
      i = j - 1;
      continue;
    }
    // name: "question" followed by an optional list of options.
    const list: string[] = [];
    let j = i + 1;
    while (j < lines.length && (LIST_ITEM.test(lines[j]!) || lines[j]!.trim() === "")) {
      const item = LIST_ITEM.exec(lines[j]!)?.[1];
      if (item) list.push(stripQuotes(item));
      j++;
    }
    i = j - 1;
    add(name, argumentsFor(tool, { string: stripQuotes(rest), list }));
  }
  remaining = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { calls, text: remaining, unusable, found };
}

// ---- The stream filter --------------------------------------------------------------------

type Chunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: unknown[];
      [key: string]: unknown;
    };
    finish_reason?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export interface TextToolFilter {
  /** Tools this request can call. */
  tools: readonly OfferedTool[];
  /** Tool names to remove even when they can't be called here. */
  known: readonly string[];
  /** Asks again once, with a short note, when unusable tool syntax was the whole reply. */
  retry?: () => Promise<Response>;
}

const encoder = new TextEncoder();
const event = (chunk: unknown) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
let callSeq = 0;

/** Wraps a streamed chat-completions reply from a local model (see the top of this file). */
export async function filterTextToolCalls(
  response: Response,
  filter: TextToolFilter,
): Promise<Response> {
  const names = [...new Set([...filter.tools.map((tool) => tool.name), ...filter.known])].sort(
    (a, b) => b.length - a.length,
  );
  const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!response.ok || !response.body || names.length === 0) return response;
  if (!isStream) return filterJsonReply(response, filter);

  const body = response.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder();
      let buffer = "";
      let line = ""; // the current text line, not shown yet
      let held = ""; // text held back from the first tool-like line on
      let holding = false;
      let shownAny = false;
      let template: Chunk = {};
      let finished = false;
      const show = (text: string) => {
        if (!text) return;
        shownAny = true;
        controller.enqueue(
          event({
            ...template,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          }),
        );
      };
      // While text is held back, an empty chunk now and then tells the runtime the model is
      // still writing; without it a long held tool call (a whole web page) looked like a stall.
      let lastSignal = Date.now();
      const keepAlive = () => {
        if (Date.now() - lastSignal < KEEPALIVE_MS) return;
        lastSignal = Date.now();
        controller.enqueue(
          event({ ...template, choices: [{ index: 0, delta: {}, finish_reason: null }] }),
        );
      };
      const takeText = (text: string) => {
        if (holding) {
          held += text;
          keepAlive();
          return;
        }
        line += text;
        let newline = line.indexOf("\n");
        while (newline >= 0) {
          const whole = line.slice(0, newline);
          if (startsToolSyntax(whole, names)) {
            holding = true;
            held = line;
            line = "";
            return;
          }
          show(`${whole}\n`);
          line = line.slice(newline + 1);
          newline = line.indexOf("\n");
        }
        if (line && startsToolSyntax(line, names)) {
          holding = true;
          held = line;
          line = "";
        } else if (line && !mayStartToolSyntax(line, names)) {
          show(line);
          line = "";
        }
      };
      const finish = async (finishChunk: Chunk | null): Promise<"done" | "retried"> => {
        const pending = holding ? held : line;
        holding = false;
        held = "";
        line = "";
        const read = readTextToolCalls(pending, filter.tools, filter.known);
        if (!read.found) {
          show(pending);
          if (finishChunk) controller.enqueue(event(finishChunk));
          return "done";
        }
        if (read.unusable && read.calls.length === 0 && !shownAny && !read.text && filter.retry) {
          const again = await filter.retry().catch(() => null);
          if (again?.ok && again.body) {
            const filtered = await filterTextToolCalls(again, { ...filter, retry: undefined });
            const reader = filtered.body!.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            return "retried";
          }
        }
        show(read.text);
        if (read.calls.length) {
          controller.enqueue(
            event({
              ...template,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: read.calls.map((call, index) => ({
                      index,
                      id: `call_text_${Date.now().toString(36)}_${++callSeq}`,
                      type: "function",
                      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                    })),
                  },
                  finish_reason: null,
                },
              ],
            }),
          );
          controller.enqueue(
            event({
              ...(finishChunk ?? template),
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            }),
          );
        } else if (finishChunk) controller.enqueue(event(finishChunk));
        return "done";
      };

      const reader = body.getReader();
      try {
        outer: for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end = buffer.indexOf("\n");
          while (end >= 0) {
            const raw = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            end = buffer.indexOf("\n");
            if (!raw.startsWith("data:")) {
              if (raw.trim()) controller.enqueue(encoder.encode(`${raw}\n\n`));
              continue;
            }
            const data = raw.slice(5).trim();
            if (data === "[DONE]") {
              if (!finished && (await finish(null)) === "retried") {
                finished = true;
                break outer;
              }
              finished = true;
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            let chunk: Chunk;
            try {
              chunk = JSON.parse(data) as Chunk;
            } catch {
              controller.enqueue(encoder.encode(`${raw}\n\n`));
              continue;
            }
            const { choices, ...meta } = chunk;
            template = { ...meta };
            const choice = choices?.[0];
            if (!choice) {
              controller.enqueue(event(chunk));
              continue;
            }
            const { content, tool_calls: realCalls, ...otherDelta } = choice.delta ?? {};
            if (typeof content === "string" && content) takeText(content);
            if (realCalls?.length) {
              // A real tool call: whatever was held back is text after all.
              show(holding ? held : line);
              holding = false;
              held = "";
              line = "";
            }
            const passDelta = { ...otherDelta, ...(realCalls ? { tool_calls: realCalls } : {}) };
            if (choice.finish_reason) {
              const finishChunk = { ...chunk, choices: [{ ...choice, delta: passDelta }] };
              if ((await finish(finishChunk)) === "retried") {
                finished = true;
                break outer;
              }
              finished = true;
              continue;
            }
            if (Object.keys(passDelta).length)
              controller.enqueue(event({ ...chunk, choices: [{ ...choice, delta: passDelta }] }));
          }
        }
        if (!finished) await finish(null);
      } catch (error) {
        controller.error(error);
        return;
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** The same for a reply that is not streamed. */
async function filterJsonReply(response: Response, filter: TextToolFilter): Promise<Response> {
  const text = await response.text();
  let parsed: {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: unknown[] };
      finish_reason?: string;
    }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(text, { status: response.status, headers: response.headers });
  }
  const message = parsed.choices?.[0]?.message;
  if (message && typeof message.content === "string" && !message.tool_calls?.length) {
    const read = readTextToolCalls(message.content, filter.tools, filter.known);
    if (read.found) {
      message.content = read.text;
      if (read.calls.length) {
        message.tool_calls = read.calls.map((call) => ({
          id: `call_text_${Date.now().toString(36)}_${++callSeq}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
        parsed.choices![0]!.finish_reason = "tool_calls";
      }
    }
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(parsed), { status: response.status, headers });
}

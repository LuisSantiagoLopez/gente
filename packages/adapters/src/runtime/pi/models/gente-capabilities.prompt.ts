// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente: tells the local model what it can do, from the tools the request actually offers.
// A local model that was never told its computer is in the cloud said "I can't open a cloud
// computer"; one never told it may look at the person's screen offered menus instead of looking.
// The section is built only from the request's tool names (and whether the bot's computer is
// hosted in the cloud), in a fixed order, so the same tools always give the same bytes and the
// model server keeps reusing the prompt it already read.

type WireTool = { function?: { name?: unknown; description?: unknown } };

/** The tool names a request offers, plus the hidden built-ins find_tool lists by name. */
export function offeredToolNames(tools: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(tools)) return names;
  for (const tool of tools as WireTool[]) {
    const name = tool?.function?.name;
    if (typeof name !== "string") continue;
    names.add(name);
    // find_tool's description ends with an index of the built-ins it can reach, one area a line.
    if (name === "find_tool" && typeof tool.function?.description === "string") {
      for (const line of tool.function.description.split("\n").slice(1)) {
        if (!/^\s/.test(line)) continue;
        for (const hidden of line.split(",")) {
          const trimmed = hidden.trim();
          if (/^[a-z][a-z0-9_]*$/.test(trimmed)) names.add(`find_tool:${trimmed}`);
        }
      }
    }
  }
  return names;
}

interface Group {
  needs: readonly string[];
  line: (has: (name: string) => boolean, options: CapabilityOptions) => string;
}

export interface CapabilityOptions {
  /** The bot's own computer is hosted in the cloud, not on this Mac. */
  computerInCloud: boolean;
}

const any = (has: (name: string) => boolean, names: readonly string[]) => names.some(has);

/** Tool groups in a fixed order. A group shows only when the request offers one of its tools. */
const GROUPS: readonly Group[] = [
  {
    needs: ["user_computer_observe"],
    line: () =>
      '- The person\'s own screen (user_computer_observe, user_computer_act): for "look at my screen" or "what am I looking at", call user_computer_observe now and describe what you see.',
  },
  {
    needs: ["computer_observe", "computer_act", "browser_navigate"],
    line: (has, { computerInCloud }) => {
      const tools = ["computer_observe", "computer_act", "browser_navigate", "shell"].filter(has);
      const look = has("computer_observe") ? "computer_observe" : tools[0];
      const browse = has("browser_navigate") ? "browser_navigate" : tools[0];
      const where = computerInCloud
        ? "your own computer in the cloud, a full desktop with a web browser, terminal and files. It starts by itself when you use it"
        : "your own computer, a full desktop with a web browser, terminal and files";
      return `- Computer (${tools.join(", ")}): ${where}. For "open a computer in the cloud" or "show me your computer", call ${look} now so its screen shows. Its browser is your cloud browser: for "browse X", "use a cloud browser", "use Browserbase" or "order an Uber", open the site with ${browse} and do the task.`;
    },
  },
  {
    needs: ["web_search", "web_fetch"],
    line: (has) =>
      `- Web (${["web_search", "web_fetch"].filter(has).join(", ")}): for news, prices or anything current, search now${has("web_fetch") ? ", read the best pages" : ""} and give the links.`,
  },
  {
    needs: ["write_file"],
    line: (has) =>
      `- Files (${["write_file", "read_file", "list_files"].filter(has).join(", ")}): for "make me a website" or any document, write the files now; choose the purpose, style and sections yourself.`,
  },
  {
    needs: ["connect_app"],
    line: () =>
      "- Apps (connect_app): email, calendar, Slack and other apps. Use a connected app's tools; if the app is not connected, call connect_app.",
  },
  {
    needs: ["generate_image", "generate_video"],
    line: (has) =>
      `- Media (${["generate_image", "generate_video"].filter(has).join(", ")}): make pictures${has("generate_video") ? " and short videos" : ""} when asked.`,
  },
  {
    needs: ["find_tool:render_plot", "find_tool:save_page", "render_plot", "save_page"],
    line: () =>
      "- Charts and pages (render_plot, save_page, through find_tool): charts, dashboards, reports.",
  },
  {
    needs: ["remember", "save_memory"],
    line: (has) =>
      `- Memory (${["remember", "save_memory"].filter(has).join(", ")}): keep facts the person wants you to remember.`,
  },
  {
    needs: ["schedule_create"],
    line: () => '- Routines (schedule_create): for "every morning" or "remind me", create it now.',
  },
  {
    needs: ["run_subagent"],
    line: () => "- Helpers (run_subagent): run a long side task while you keep talking.",
  },
];

/** Rules that hold whichever tools are offered. */
function rules(has: (name: string) => boolean): string[] {
  return [
    'Act first: when an ask matches a tool, call it in this reply. Never answer with a menu of options or "what would you like me to do?".',
    `Just do it: a request to pay, send or delete is the approval, so do it with no confirm step. Stop and ask${has("ask_user") ? " with ask_user" : ""} only when the action would go beyond what was asked (another recipient, amount or extra item), or when the ask is truly ambiguous and a wrong guess cannot be undone.`,
    "Never deny a capability listed here, and never claim one that is not.",
    '"What can you do?": answer in a few short lines from this list, in plain words.',
  ];
}

const OPEN = "<capabilities>";
const CLOSE = "</capabilities>";

/** The capability section for these tools, or null when the request offers none. */
export function capabilitySection(tools: unknown, options: CapabilityOptions): string | null {
  const names = offeredToolNames(tools);
  if (names.size === 0) return null;
  const has = (name: string) => names.has(name);
  const lines = GROUPS.filter((group) => any(has, group.needs)).map((group) =>
    group.line(has, options),
  );
  if (!has("user_computer_observe"))
    lines.push(
      '- You cannot see the person\'s own screen right now. If they ask, tell them in one sentence to turn on "Let bots use this computer" in Settings.',
    );
  return [
    OPEN,
    "Your tools right now:",
    ...lines,
    "Rules:",
    ...rules(has).map((rule) => `- ${rule}`),
    CLOSE,
  ].join("\n");
}

/** A system prompt without its capability section, for slim prompts that offer other tools. */
export function withoutCapabilities(system: string): string {
  const at = system.indexOf(OPEN);
  if (at < 0) return system;
  const end = system.indexOf(CLOSE, at);
  if (end < 0) return system;
  return `${system.slice(0, at).trimEnd()}${system.slice(end + CLOSE.length)}`;
}

type Message = { role?: string; content?: unknown; [key: string]: unknown };

/** Adds the capability section to the end of the system prompt, once. */
export function withCapabilities(
  messages: Message[],
  tools: unknown,
  options: CapabilityOptions,
): Message[] {
  const first = messages[0];
  if (first?.role !== "system" || typeof first.content !== "string") return messages;
  if (first.content.includes(OPEN)) return messages;
  const section = capabilitySection(tools, options);
  if (!section) return messages;
  return [{ ...first, content: `${first.content}\n\n${section}` }, ...messages.slice(1)];
}

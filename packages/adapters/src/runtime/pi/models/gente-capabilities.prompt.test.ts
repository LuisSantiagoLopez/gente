// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { describe, expect, it } from "vitest";
import {
  bridgeToolDefinitions,
  builtinAgentTools,
} from "../../../tools/builtin.tool-definition.js";
import { quickChatBody, slimSystemPrompt } from "./burrow-fast-chat.js";
import {
  capabilitySection,
  offeredToolNames,
  withCapabilities,
  withoutCapabilities,
} from "./gente-capabilities.prompt.js";
import { REAL_RUN_TOOLS, wire } from "./gente-capabilities.test-support.js";

const ALL_BUILTIN_NAMES = new Set([...builtinAgentTools.map((tool) => tool.name), "find_tool"]);

/** Every built-in tool name the section mentions. */
function mentionedTools(section: string): string[] {
  return [...new Set(section.match(/[a-z]+(?:_[a-z]+)+/g) ?? [])].filter((word) =>
    ALL_BUILTIN_NAMES.has(word),
  );
}

const cloud = { computerInCloud: true };

describe("capabilitySection", () => {
  it("names only tools the request offers or find_tool reaches", () => {
    const tools = wire(REAL_RUN_TOOLS);
    const section = capabilitySection(tools, cloud)!;
    const offered = offeredToolNames(tools);
    for (const name of mentionedTools(section)) {
      expect(offered.has(name) || offered.has(`find_tool:${name}`), name).toBe(true);
    }
  });

  it("drops a tool's capability when that tool is not offered", () => {
    for (const removed of REAL_RUN_TOOLS) {
      const section = capabilitySection(
        wire(REAL_RUN_TOOLS.filter((name) => name !== removed)),
        cloud,
      )!;
      expect(mentionedTools(section), removed).not.toContain(removed);
    }
  });

  it("describes each offered tool group, in a fixed order", () => {
    const section = capabilitySection(wire(REAL_RUN_TOOLS), cloud)!;
    const groups = section
      .slice(0, section.indexOf("Rules:"))
      .split("\n")
      .filter((line) => line.startsWith("- ") && line.includes("("))
      .map((line) => line.slice(2, line.indexOf(" (")));
    expect(groups).toEqual([
      "Computer",
      "Web",
      "Files",
      "Apps",
      "Charts and pages",
      "Memory",
      "Routines",
      "Helpers",
    ]);
  });

  it("offers the person's screen only with the screen tools", () => {
    const without = capabilitySection(wire(REAL_RUN_TOOLS), cloud)!;
    expect(without).not.toContain("user_computer_observe");
    expect(without).toContain("Let bots use this computer");
    const withScreen = capabilitySection(
      wire([...REAL_RUN_TOOLS, "user_computer_observe", "user_computer_act"]),
      cloud,
    )!;
    expect(withScreen.split("\n")[2]).toContain("call user_computer_observe now");
    expect(withScreen).not.toContain("Let bots use this computer");
  });

  it("says the computer is in the cloud only when it is", () => {
    expect(capabilitySection(wire(REAL_RUN_TOOLS), cloud)).toContain(
      "your own computer in the cloud",
    );
    expect(capabilitySection(wire(REAL_RUN_TOOLS), { computerInCloud: false })).not.toContain(
      "your own computer in the cloud",
    );
  });

  it("is the same bytes for the same tools in any order", () => {
    const tools = wire(REAL_RUN_TOOLS);
    expect(capabilitySection([...tools].reverse(), cloud)).toBe(capabilitySection(tools, cloud));
  });

  it("stays short", () => {
    const everything = wire([
      ...REAL_RUN_TOOLS,
      "user_computer_observe",
      "user_computer_act",
      "generate_image",
      "generate_video",
      "browser_navigate",
    ]);
    // About four characters a token: under about 600 tokens.
    expect(capabilitySection(everything, cloud)!.length).toBeLessThan(2400);
  });

  it("is empty when no tools are offered", () => {
    expect(capabilitySection([], cloud)).toBeNull();
    expect(capabilitySection(undefined, cloud)).toBeNull();
  });
});

describe("withCapabilities", () => {
  const system = { role: "system", content: "You are a bot." };
  const user = { role: "user", content: "what can you do?" };

  it("adds the section once, at the end of the system prompt", () => {
    const once = withCapabilities([system, user], wire(REAL_RUN_TOOLS), cloud);
    const twice = withCapabilities(once, wire(REAL_RUN_TOOLS), cloud);
    expect(twice).toEqual(once);
    expect(String(once[0]!.content).endsWith("</capabilities>")).toBe(true);
    expect(once[1]).toBe(user);
  });

  it("is removed from slim prompts, which offer other tools", () => {
    const [withSection] = withCapabilities([system, user], wire(REAL_RUN_TOOLS), cloud);
    expect(withoutCapabilities(String(withSection!.content))).toBe(system.content);
    expect(slimSystemPrompt(String(withSection!.content))).not.toContain("<capabilities>");
  });
});

describe("the local request", () => {
  const request = (content: string, names = REAL_RUN_TOOLS) =>
    JSON.stringify({
      model: "m",
      messages: [
        { role: "system", content: "You are a bot.\n\nMore rules." },
        { role: "user", content },
      ],
      tools: wire(names),
      reasoning_effort: "medium",
    });
  const system = (body: string) => JSON.parse(body).messages[0].content as string;

  it("carries the section for its own tools", () => {
    const out = quickChatBody(request("open a computer on the cloud"))!;
    expect(system(out.body)).toContain("<capabilities>");
    expect(system(out.body)).toContain("computer_observe");
  });

  it("a coding turn gets a section for the code tools only", () => {
    const out = quickChatBody(request("write a python script that adds two numbers"))!;
    const section = system(out.body).slice(system(out.body).indexOf("<capabilities>"));
    expect(section).toContain("write_file");
    expect(section).not.toContain("computer_observe");
  });

  it("small talk, which offers no tools, gets no section", () => {
    const out = quickChatBody(request("hola"))!;
    expect(system(out.body)).not.toContain("<capabilities>");
  });
});

// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// The tool list of a real desktop chat, rebuilt from the built-in definitions in the wire shape
// the local model receives, for the capability tests and the live evals.
import {
  bridgeToolDefinitions,
  builtinAgentTools,
} from "../../../tools/builtin.tool-definition.js";

/** The built-in tools a real desktop chat offered the model (v1.0.6, one bot, cloud computers). */
export const REAL_RUN_TOOLS = [
  "ask_user",
  "attach_file",
  "computer_act",
  "computer_observe",
  "connect_app",
  "goal_update",
  "list_files",
  "message_bot",
  "message_user",
  "project_update",
  "read_file",
  "read_history",
  "remember",
  "request_secret",
  "request_takeover",
  "run_subagent",
  "schedule_create",
  "schedule_list",
  "search_history",
  "shell",
  "skill_read",
  "update_bot",
  "update_preferences",
  "web_fetch",
  "web_search",
  "write_file",
];
/** What find_tool listed in that run as reachable built-ins, by area. */
export const REAL_RUN_HIDDEN =
  "bots:\n  archive_bot, spawn_bot\nmedia:\n  render_plot, save_page\nother:\n  launch_app, open_path";

export const wire = (names: readonly string[], hidden = REAL_RUN_HIDDEN) => [
  ...names.map((name) => {
    const tool = builtinAgentTools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`unknown built-in ${name}`);
    return {
      type: "function",
      function: { name, description: tool.description, parameters: tool.inputSchema },
    };
  }),
  ...bridgeToolDefinitions(hidden).map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  })),
];

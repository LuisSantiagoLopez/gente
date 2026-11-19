// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).

import { app } from "electron";
import { desktop } from "../desktop-state.js";
import { handleIpc } from "../ipc/ipc.js";
import { Brain, ollamaInstalled, prewarmSwift, startOllama } from "./brain.js";
import { checkEntitlement } from "./entitlement.js";

let brain: Brain | null = null;

export function registerBrainIpc(stackDirectory: string) {
  app.setAboutPanelOptions({
    applicationName: "Gente",
    applicationVersion: `${app.getVersion()} · Plan: ${checkEntitlement().label}`,
    copyright: "Copyright 2026 DeskHead Inc.",
    credits:
      "Based on Rakazo by Elie Steinbock (Apache-2.0), github.com/elie222/rakazo.\n" +
      "Default model: Swift 1.5 by UkisAI, run locally with Ollama.",
  });
  brain = new Brain(stackDirectory, (state) => {
    const win = desktop.setupWindow;
    if (win !== null && !win.isDestroyed()) win.webContents.send("desktop.setup.brain.changed", state);
  }, async () => {
    // The API and worker read the default model when they start.
    if (desktop.localStack.managedStackRunning()) await desktop.localStack.stop();
  });
  void brain.loadSaved();
  handleIpc("desktop.setup.brain.state", () => (brain as Brain).current());
  handleIpc("desktop.setup.brain.start", (_event, options) => {
    const opts =
      typeof options === "object" && options !== null
        ? (options as { installOllama?: unknown; model?: unknown })
        : {};
    void (brain as Brain).start({
      installOllama: opts.installOllama === true,
      model: typeof opts.model === "string" ? opts.model : undefined,
    });
    return (brain as Brain).current();
  });
  // On a later launch the person's Ollama may not be running yet; bots need it. Then have the
  // quick model read the small-talk prompt, so the first "hey" answers at once.
  if (ollamaInstalled())
    void startOllama().then((up) => (up ? prewarmSwift(stackDirectory) : false));
}

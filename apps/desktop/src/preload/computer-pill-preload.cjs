// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
const { contextBridge, ipcRenderer } = require("electron");

// A sandboxed preload can only require electron, so channels are named here as literals.
// ipc-channels.ts lists who may call each one; ipc-channels.test.ts fails when the two disagree.

contextBridge.exposeInMainWorld("gentePill", {
  stop: () => ipcRenderer.invoke("desktop.computerPill.stop"),
  hover: (over) => ipcRenderer.invoke("desktop.computerPill.hover", over === true),
  onState: (listener) => {
    ipcRenderer.on("desktop.computerPill.state", (_event, state) => listener(state));
  },
});

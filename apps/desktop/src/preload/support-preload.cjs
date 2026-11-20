// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
const { contextBridge, ipcRenderer } = require("electron");

// A sandboxed preload can only require electron, so channels are named here as literals.
// ipc-channels.ts lists who may call each one; ipc-channels.test.ts fails when the two disagree.
contextBridge.exposeInMainWorld("genteSupport", {
  state: () => ipcRenderer.invoke("gente.support.state"),
  check: () => ipcRenderer.invoke("gente.support.check"),
  ask: (question, history) => ipcRenderer.invoke("gente.support.ask", question, history),
  fix: (id) => ipcRenderer.invoke("gente.support.fix", id),
  feedback: (helpful) => ipcRenderer.invoke("gente.support.feedback", helpful),
  ticket: (ticket) => ipcRenderer.invoke("gente.support.ticket", ticket),
  answerReport: (answer) => ipcRenderer.invoke("gente.support.answerReport", answer),
  saveSettings: (patch) => ipcRenderer.invoke("gente.support.saveSettings", patch),
  articles: () => ipcRenderer.invoke("gente.support.articles"),
  onEvent: (listener) => {
    ipcRenderer.on("gente.support.event", (_event, payload) => listener(payload));
  },
  onState: (listener) => {
    ipcRenderer.on("gente.support.changed", (_event, state) => listener(state));
  },
});

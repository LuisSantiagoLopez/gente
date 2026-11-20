// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("genteMeeting", {
  started: (sources) => ipcRenderer.send("gente.meeting.started", sources),
  finished: (pcm) => ipcRenderer.send("gente.meeting.finished", pcm),
  onStop: (listener) => ipcRenderer.on("gente.meeting.stop", () => listener()),
});

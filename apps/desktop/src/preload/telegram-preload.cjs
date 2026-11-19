// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("genteTelegram", {
  connect: (token) => ipcRenderer.invoke("gente.telegram.connect", token),
});

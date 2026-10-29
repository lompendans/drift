"use strict";
// Drift's own interface (the window, the menus and the notification pop-ups) talks to the main process through this.
const { contextBridge, ipcRenderer } = require("electron");

const listeners = [];
ipcRenderer.on("host", (_, data) => { for (const l of listeners) l({ data }); });

contextBridge.exposeInMainWorld("driftHost", {
  postMessage: m => ipcRenderer.send("host", m),
  addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
  platform: process.platform,
});

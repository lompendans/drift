"use strict";
// Drift's own downloads: saves straight to the Downloads folder, follows each file's progress,
// and keeps a list (saved in state.json) for the Downloads panel.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, shell } = require("electron");

function uniquePath(dir, name) {
  name = (name || "download").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "") || "download";
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 1; fs.existsSync(p) || fs.existsSync(p + ".crdownload"); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

class Downloads {
  constructor(store) {
    this.store = store;
    this.live = new Map();          // id -> { item, pauseAsked, lastBytes, lastAt, speed }
    this.onChanged = () => { };      // (important) => …: true when it's worth saving (not just more bytes)
    this.onStarted = () => { };
    // A download can't carry on after Drift closes.
    for (const d of store.Downloads)
      if (d.State === "progress" || d.State === "paused") { d.State = "failed"; d.Reason = "Drift was closed before it finished"; }
  }

  get folder() { return app.getPath("downloads"); }
  get activeCount() { return this.store.Downloads.filter(d => d.State === "progress" || d.State === "paused").length; }

  /** Follows a new download. `savePath` is where the user chose to save it (Save as…); otherwise it goes to Downloads. */
  begin(item, savePath) {
    fs.mkdirSync(this.folder, { recursive: true });
    const save = savePath || uniquePath(this.folder, item.getFilename());
    item.setSavePath(save);
    const d = { Id: crypto.randomUUID().replace(/-/g, ""), Url: item.getURL(), Path: save, Total: item.getTotalBytes() || 0, Received: 0, State: "progress", Reason: null, Started: new Date().toISOString() };
    const l = { item, pauseAsked: false, lastBytes: 0, lastAt: Date.now(), speed: 0 };
    this.live.set(d.Id, l);
    this.store.Downloads.unshift(d);
    if (this.store.Downloads.length > 200) this.store.Downloads.length = 200;

    item.on("updated", (_, state) => {
      d.Received = item.getReceivedBytes();
      if (!d.Total) d.Total = item.getTotalBytes() || 0;
      const was = d.State;
      if (state === "interrupted") {
        d.State = item.canResume() ? "paused" : "failed";
        if (d.State === "failed") d.Reason = "Network error";
      } else d.State = item.isPaused() ? "paused" : "progress";
      if (d.State === "progress") {
        d.Reason = null;
        const now = Date.now(), dt = (now - l.lastAt) / 1000;
        if (was !== "progress") { l.lastAt = now; l.lastBytes = d.Received; l.speed = 0; }
        else if (dt >= 0.4) {
          const speed = (d.Received - l.lastBytes) / dt;
          l.speed = l.speed === 0 ? speed : l.speed * 0.65 + speed * 0.35;
          l.lastBytes = d.Received; l.lastAt = now;
        }
      }
      this.onChanged(was !== d.State);
    });
    item.once("done", (_, state) => {
      d.Path = item.getSavePath();
      d.Received = item.getReceivedBytes();
      if (state === "completed") { d.State = "done"; d.Total = d.Received; }
      else if (state === "cancelled") d.State = "canceled";
      else { d.State = "failed"; d.Reason = "The download was interrupted"; }
      this.live.delete(d.Id);
      this.onChanged(true);
    });
    this.onStarted(d);
    this.onChanged(true);
  }

  find(id) { return this.store.Downloads.find(x => x.Id === id); }

  /** Runs a button from the Downloads panel. Returns an address to download again, for "Retry". */
  do(action, id) {
    const d = this.find(id), l = this.live.get(id || "");
    switch (action) {
      case "pause": if (l) { l.pauseAsked = true; l.item.pause(); d.State = "paused"; this.onChanged(true); } break;
      case "resume": if (l && l.item.canResume()) { l.pauseAsked = false; l.item.resume(); } break;
      case "cancel": if (l) l.item.cancel(); break;
      case "open": if (d && fs.existsSync(d.Path)) shell.openPath(d.Path); break;
      case "show": if (d) Downloads.showInFolder(d.Path); break;
      case "remove":
        if (d && d.State !== "progress" && d.State !== "paused") { this.store.Downloads.splice(this.store.Downloads.indexOf(d), 1); this.onChanged(true); }
        break;
      case "clear":
        this.store.Downloads = this.store.Downloads.filter(x => x.State === "progress" || x.State === "paused");
        this.onChanged(true);
        break;
      case "retry":
        if (d) { this.store.Downloads.splice(this.store.Downloads.indexOf(d), 1); this.onChanged(true); return d.Url; }
        break;
    }
    return null;
  }

  static showInFolder(p) {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
    else if (p && fs.existsSync(path.dirname(p))) shell.openPath(path.dirname(p));
  }

  dto() {
    return this.store.Downloads.map(d => {
      const l = this.live.get(d.Id);
      let host = "";
      try { host = new URL(d.Url).host; } catch { }
      return {
        id: d.Id, name: path.basename(d.Path || "") || host, host, url: d.Url, state: d.State, reason: d.Reason,
        received: d.Received, total: d.Total, speed: l && d.State === "progress" ? Math.round(l.speed) : 0,
        exists: d.State === "done" && !!d.Path && fs.existsSync(d.Path), canResume: !!l && l.item.canResume(), started: d.Started,
      };
    });
  }
}

module.exports = { Downloads };

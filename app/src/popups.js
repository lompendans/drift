"use strict";
// Drift's small windows: the right-click menu and notification pop-ups (ui/popup.html),
// and extension pop-ups (the page under an extension's toolbar button).
const path = require("path");
const { BrowserWindow, screen, ipcMain } = require("electron");

const preload = path.join(__dirname, "preload-ui.js");
const Margin = 12;   // the transparent edge around the panel, where its shadow draws

function popupWindow(parent, opts) {
  const w = new BrowserWindow(Object.assign({
    parent, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, width: 10, height: 10, backgroundColor: "#00000000",
    webPreferences: { preload, contextIsolation: true, sandbox: true, spellcheck: false },
  }, opts));
  w.setMenu(null);
  return w;
}

// Messages from popup.html arrive on the shared "host" channel; route them to the window they came from.
const handlers = new Map();   // webContents id -> fn
function route(wc, fn) {
  handlers.set(wc.id, fn);
  wc.once("destroyed", () => handlers.delete(wc.id));
}
function dispatch(e, m) {
  const fn = handlers.get(e.sender.id);
  if (fn) { fn(m); return true; }
  return false;
}

/** Opens a menu at a screen point. Resolves with the picked entry's id, or null. */
function showMenu(parent, point, entries) {
  return new Promise(resolve => {
    const w = popupWindow(parent, { focusable: true, alwaysOnTop: true });
    let done = false;
    const finish = id => {
      if (done) return;
      done = true;
      resolve(id);
      if (!w.isDestroyed()) w.destroy();
    };
    route(w.webContents, m => {
      if (m.type === "ready") w.webContents.send("host", { type: "menu", entries });
      else if (m.type === "size") {
        const area = screen.getDisplayNearestPoint(point).workArea;
        const width = Math.min(m.w, area.width), height = Math.min(m.h, area.height);
        // open down and to the right of the pointer, flipping where the screen ends
        let x = point.x - Margin + 2, y = point.y - Margin + 2;
        if (x + width > area.x + area.width) x = point.x - width + Margin - 2;
        if (y + height > area.y + area.height) y = Math.max(area.y, point.y - height + Margin - 2);
        w.setBounds({ x: Math.max(area.x - Margin, Math.round(x)), y: Math.round(y), width, height });
        w.show();
        w.focus();
        w.webContents.focus();
        w.webContents.send("host", { type: "show" });
      } else if (m.type === "pick") finish(m.id);
      else if (m.type === "cancel") finish(null);
    });
    w.on("blur", () => finish(null));
    w.on("closed", () => finish(null));
    w.loadURL("drift://ui/popup.html");
  });
}

/** A notification pop-up in the corner of the screen. */
class Toast {
  constructor(parent, info, { onClick, onClosed }) {
    this.info = info;
    this.key = info.key;
    this.closing = false;
    this.hover = false;
    this.size = { width: 384, height: 96 };
    this.onClick = onClick; this.onClosed = onClosed;
    this.w = popupWindow(null, { focusable: false, alwaysOnTop: true });
    this.w.setAlwaysOnTop(true, "pop-up-menu");
    route(this.w.webContents, m => {
      if (m.type === "ready") this.w.webContents.send("host", Object.assign({ type: "toast" }, info));
      else if (m.type === "size") {
        this.size = { width: m.w, height: m.h };
        this.placed = true;
        Toast.layout();
        this.w.showInactive();
        this.w.webContents.send("host", { type: "show" });
        this.arm();
      } else if (m.type === "click") { this.onClick(); this.dismiss(true); }
      else if (m.type === "dismiss") this.dismiss(true);
      else if (m.type === "hover") { this.hover = m.on; if (!m.on) this.arm(); }
    });
    this.w.on("closed", () => this.finish(false));
    this.w.loadURL("drift://ui/popup.html");
    Toast.all.push(this);
    while (Toast.all.filter(t => !t.closing).length > 4) Toast.all.find(t => !t.closing).dismiss(true);
  }

  // closes by itself after a while, unless the site asked it to stay or the pointer is on it
  arm() {
    clearTimeout(this.timer);
    if (this.info.requireInteraction) return;
    this.timer = setTimeout(() => { if (this.hover) this.arm(); else this.dismiss(true); }, 7000);
  }

  dismiss(report) {
    if (this.closing) return;
    this.closing = true;
    this.report = report;
    clearTimeout(this.timer);
    if (!this.w.isDestroyed()) {
      this.w.webContents.send("host", { type: "hide" });
      setTimeout(() => { if (!this.w.isDestroyed()) this.w.destroy(); }, 160);
    }
    Toast.layout();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    Toast.all.splice(Toast.all.indexOf(this), 1);
    this.onClosed(this.report !== false);
    Toast.layout();
  }

  static layout() {
    const area = screen.getPrimaryDisplay().workArea;
    let y = area.y + area.height - 4;
    for (let i = Toast.all.length - 1; i >= 0; i--) {
      const t = Toast.all[i];
      if (t.closing || !t.placed || t.w.isDestroyed()) continue;
      y -= t.size.height;
      t.w.setBounds({ x: area.x + area.width - t.size.width - 4, y, width: t.size.width, height: t.size.height });
      y += 2 * Margin - 10;   // 10px between panels; their transparent edges overlap
    }
  }
}
Toast.all = [];

/** An extension's pop-up: its page in a small window under the toolbar button, sized to fit, closing when you click away. */
class ExtensionPopup {
  constructor(parent, anchor, url, session, onOpenTab) {
    this.anchor = anchor;   // top-right corner to hang from, in screen coordinates
    const w = this.w = new BrowserWindow({
      parent, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, width: 40, height: 40, roundedCorners: true,
      webPreferences: { session, contextIsolation: true, sandbox: true },
    });
    w.setMenu(null);
    w.webContents.setWindowOpenHandler(d => { onOpenTab(d.url); return { action: "deny" }; });
    w.webContents.on("before-input-event", (e, input) => { if (input.type === "keyDown" && input.key === "Escape") w.close(); });
    let ready = false;
    w.on("blur", () => { if (ready && !w.isDestroyed()) w.close(); });
    w.webContents.on("did-finish-load", async () => {
      // pop-ups often draw after loading, and their height depends on the width, so measure until it settles
      for (let i = 0; i < 4 && await this.fit(); i++) await new Promise(r => setTimeout(r, 120));
      await new Promise(r => setTimeout(r, 150));
      await this.fit();
      if (w.isDestroyed()) return;
      ready = true;
      w.show();
    });
    this.place({ width: 40, height: 40 });
    w.loadURL(url);
  }

  place(size) {
    const area = screen.getDisplayNearestPoint(this.anchor).workArea;
    const x = Math.max(area.x, Math.min(this.anchor.x - size.width, area.x + area.width - size.width));
    const y = Math.min(this.anchor.y, area.y + area.height - size.height);
    this.w.setBounds({ x, y, width: size.width, height: size.height });
  }

  async fit() {
    if (this.w.isDestroyed()) return false;
    try {
      const [sw, sh] = await this.w.webContents.executeJavaScript(
        "(() => { const d = document.documentElement, b = document.body || d; return [Math.max(d.scrollWidth, b.scrollWidth), Math.max(d.scrollHeight, b.scrollHeight)]; })()");
      const width = Math.round(Math.min(800, Math.max(40, sw))), height = Math.round(Math.min(600, Math.max(40, sh)));
      const b = this.w.getBounds();
      if (Math.abs(width - b.width) > 2 || Math.abs(height - b.height) > 2) { this.place({ width, height }); return true; }
    } catch { }
    return false;
  }

  close() { if (!this.w.isDestroyed()) this.w.close(); }
}

module.exports = { showMenu, Toast, ExtensionPopup, dispatch };

"use strict";
// Drift Legacy starts here: the same Drift, on an older Electron (22 for Windows 7/8/8.1 and 32-bit Windows, 18 for
// 32-bit Linux). This file fills in the parts of Electron and Node those versions don't have yet, then starts Drift.
// Their Chromium no longer gets security fixes; Drift Legacy says so wherever it can (see build.js).
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { fileURLToPath } = require("url");
const electron = require("electron");
const { app, BrowserView, BrowserWindow, protocol, net } = electron;

// ---------- app.setPath: older Electron refuses a folder that doesn't exist yet, and Electron 18 has no "sessionData"
// (the engine's files then stay in the data folder itself) ----------
const setPath = app.setPath.bind(app);
app.setPath = (name, dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { }
  try { setPath(name, dir); }
  catch (e) { if (name !== "sessionData") throw new Error(`${e.message}: ${name} = ${dir}`); }
};

// ---------- fetch-style responses (Node 16 has no Response or fetch) ----------
class Headers {
  constructor(init) {
    this.map = new Map();
    for (const [k, v] of Object.entries(init || {})) this.map.set(k.toLowerCase(), Array.isArray(v) ? v.join(", ") : String(v));
  }
  get(k) { return this.map.has(k.toLowerCase()) ? this.map.get(k.toLowerCase()) : null; }
}
class Response {
  constructor(body, init = {}) {
    this.raw = body == null ? Buffer.alloc(0) : body;   // a Buffer, a string, or a stream of chunks
    this.status = init.status || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
  }
  get body() {
    if (typeof this.raw === "string" || Buffer.isBuffer(this.raw)) { const b = Buffer.from(this.raw); return (async function* () { yield b; })(); }
    return this.raw;
  }
  async buffer() {
    if (Buffer.isBuffer(this.raw)) return this.raw;
    if (typeof this.raw === "string") return Buffer.from(this.raw);
    const parts = [];
    for await (const c of this.raw) parts.push(Buffer.from(c));
    return Buffer.concat(parts);
  }
  async text() { return (await this.buffer()).toString("utf8"); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() { const b = await this.buffer(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }
}
if (typeof global.Response === "undefined") global.Response = Response;

const Types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
if (!net.fetch) {
  net.fetch = (url, opts = {}) => {
    if (url.startsWith("file:")) {
      const file = fileURLToPath(url);
      try { return Promise.resolve(new Response(fs.readFileSync(file), { headers: { "content-type": Types[path.extname(file).toLowerCase()] || "application/octet-stream" } })); }
      catch { return Promise.resolve(new Response("Not found", { status: 404 })); }
    }
    return new Promise((resolve, reject) => {
      const req = net.request({ url, method: opts.method || "GET", redirect: "follow" });
      for (const [k, v] of Object.entries(opts.headers || {})) req.setHeader(k, v);
      req.on("response", res => resolve(new Response(res, { status: res.statusCode, headers: res.headers })));
      req.on("error", reject);
      req.end();
    });
  };
}

// ---------- protocol.handle (newer Electron) on top of registerBufferProtocol ----------
if (!protocol.handle) {
  protocol.handle = (scheme, handler) => protocol.registerBufferProtocol(scheme, async (request, callback) => {
    try {
      const res = await handler({ url: request.url, method: request.method, headers: request.headers });
      const type = (res.headers.get("content-type") || "application/octet-stream").split(";")[0];
      callback({ statusCode: res.status, mimeType: type, charset: "utf-8", data: await res.buffer() });
    } catch (e) { callback({ statusCode: 500, mimeType: "text/plain", data: Buffer.from(String(e)) }); }
  });
}

// ---------- page views: WebContentsView and window.contentView, made of BrowserViews ----------
class WebContentsView {
  constructor(opts = {}) {
    this.view = new BrowserView(opts.webContents ? { webContents: opts.webContents } : { webPreferences: opts.webPreferences });
    this.webContents = this.view.webContents;
    this.visible = true;
    this.win = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }
  setBounds(b) { this.bounds = b; this.view.setBounds(b); }
  getBounds() { return this.view.getBounds(); }
  // a BrowserView can't be hidden, so a hidden one leaves its window until it shows again
  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    if (!this.win || this.win.isDestroyed()) return;
    if (on) { this.win.addBrowserView(this.view); this.view.setBounds(this.bounds); } else this.win.removeBrowserView(this.view);
  }
  getVisible() { return this.visible; }
  setBackgroundColor(c) { this.view.setBackgroundColor(c); }
  setBorderRadius() { }   // older Electron draws page views with square corners
}
class LegacyWindow extends BrowserWindow {
  constructor(opts) {
    super(opts);
    const win = this;
    Object.defineProperty(this, "contentView", {
      value: {
        addChildView(v) { v.win = win; if (v.visible) { win.addBrowserView(v.view); v.view.setBounds(v.bounds); } },
        removeChildView(v) { try { win.removeBrowserView(v.view); } catch { } v.win = null; },
      },
    });
  }
}

// Drift's files get this Electron, with the additions above. (Old Electron has an undocumented WebContentsView of
// its own that works differently, so go by the version: the one Drift uses arrived in Electron 30.)
const modern = parseInt(process.versions.electron, 10) >= 30;
const patched = Object.create(electron, {
  WebContentsView: { value: modern ? electron.WebContentsView : WebContentsView },
  BrowserWindow: { value: modern ? BrowserWindow : LegacyWindow },
});
const load = Module._load;
Module._load = function (request, parent, isMain) { return request === "electron" ? patched : load.apply(this, arguments); };

// ---------- webContents.navigationHistory ----------
app.on("web-contents-created", (_, wc) => {
  if (wc.navigationHistory) return;
  Object.defineProperty(wc, "navigationHistory", {
    value: {
      canGoBack: () => wc.canGoBack(), canGoForward: () => wc.canGoForward(),
      goBack: () => wc.goBack(), goForward: () => wc.goForward(),
      getActiveIndex: () => wc.getActiveIndex(), length: () => wc.length(), clear: () => wc.clearHistory(),
    },
  });
});

// ---------- what Electron 18 lacks: Drift's own screen-sharing picker ----------
app.on("ready", () => {
  const ses = electron.session.defaultSession;
  if (!ses.setDisplayMediaRequestHandler) ses.setDisplayMediaRequestHandler = () => { };   // sites can't share the screen there
});

require("./main");

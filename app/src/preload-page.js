"use strict";
// Runs in every tab before the page's own scripts, in a world the page can't see.
//  - Drift's own pages (drift://) get a small bridge to Drift.
//  - Web pages report the class and id names they use, so Drift can send back just the ad-hiding rules that apply.
//  - Page dialogs (alert, confirm, prompt) and notifications are shown by Drift instead of the system's.
//  - The browser brand the page sees in navigator.userAgentData says Drift, matching the user agent.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const web = /^https?:$/.test(location.protocol);
const top = window.top === window;

if (location.protocol === "drift:") {
  const listeners = [];
  ipcRenderer.on("page", (_, data) => { for (const l of listeners) l({ data }); });
  contextBridge.exposeInMainWorld("driftHost", {
    postMessage: m => ipcRenderer.send("page", m),
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
  });
}

// ---------------- ad hiding ----------------

if (web && top) {
  const seenC = new Set(), seenI = new Set();
  let pending = [], timer = 0, first = true;
  const note = el => {
    if (el.id && !seenI.has(el.id)) { seenI.add(el.id); pending.push(["i", el.id]); }
    const cl = el.classList;
    if (cl) for (const c of cl) if (!seenC.has(c)) { seenC.add(c); pending.push(["c", c]); }
  };
  const scan = root => {
    if (root.nodeType !== 1) return;
    note(root);
    for (const el of root.querySelectorAll("[id],[class]")) note(el);
  };
  const flush = () => {
    timer = 0;
    if (!pending.length && !first) return;
    const c = [], i = [];
    for (const [k, v] of pending) (k === "c" ? c : i).push(v);
    pending = [];
    ipcRenderer.send("page", { type: "drift-hide", first, c, i });
    first = false;
  };
  const later = () => { if (!timer) timer = setTimeout(flush, first ? 0 : 120); };
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === "attributes") note(r.target);
      else for (const n of r.addedNodes) scan(n);
    }
    if (pending.length || first) later();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id"] });
  if (document.documentElement) { scan(document.documentElement); later(); }
}

// ---------------- dialogs, notifications, brand ----------------

if (web || location.protocol === "file:") {
  const notes = new Map();
  ipcRenderer.on("note-event", (_, id, kind) => { const fn = notes.get(id); if (fn) fn(kind); if (kind === "close") notes.delete(id); });

  contextBridge.exposeInMainWorld("__drift", {
    dialog: (kind, message, text) => ipcRenderer.sendSync("dialog", { kind, message: String(message ?? ""), text: text == null ? "" : String(text) }),
    notify: (opts, onEvent) => {
      const id = ipcRenderer.sendSync("note-show", opts);
      if (id) notes.set(id, onEvent);
      return id;
    },
    closeNote: id => ipcRenderer.send("note-close", id),
    permission: () => ipcRenderer.sendSync("note-permission"),
    requestPermission: () => ipcRenderer.invoke("note-request"),
    brands: () => ipcRenderer.sendSync("brands"),
  });

  // Swaps in Drift's versions inside the page itself. The page keeps working the same way: alert() still waits
  // for an answer, a Notification still fires its click and close events.
  const install = () => {
    const d = window.__drift;
    if (!d) return;
    try { delete window.__drift; } catch (e) { }
    const def = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, configurable: true, writable: true }); } catch (e) { } };
    def(window, "alert", function alert(m) { d.dialog("alert", m === undefined ? "" : m); });
    def(window, "confirm", function confirm(m) { return d.dialog("confirm", m === undefined ? "" : m) === true; });
    def(window, "prompt", function prompt(m, t) { const r = d.dialog("prompt", m === undefined ? "" : m, t); return typeof r === "string" ? r : null; });

    const Real = window.Notification;
    if (Real) {
      class Notification extends EventTarget {
        constructor(title, options = {}) {
          super();
          this.title = String(title); this.body = options.body || ""; this.icon = options.icon || ""; this.tag = options.tag || "";
          this.data = options.data ?? null; this.requireInteraction = !!options.requireInteraction; this.silent = !!options.silent;
          this.onclick = this.onclose = this.onshow = this.onerror = null;
          const fire = kind => {
            const ev = new Event(kind, { cancelable: true });
            const h = this["on" + kind];
            if (typeof h === "function") try { h.call(this, ev); } catch (e) { setTimeout(() => { throw e; }); }
            this.dispatchEvent(ev);
          };
          let icon = this.icon;
          try { if (icon) icon = new URL(icon, location.href).href; } catch (e) { }
          this._id = d.notify({ title: this.title, body: String(this.body), icon, tag: String(this.tag), requireInteraction: this.requireInteraction }, fire);
          if (!this._id) setTimeout(() => fire("error"));
        }
        close() { if (this._id) d.closeNote(this._id); }
        static get permission() { return d.permission(); }
        static requestPermission(cb) {
          const p = d.requestPermission();
          if (typeof cb === "function") p.then(cb);
          return p;
        }
        static get maxActions() { return 0; }
      }
      def(window, "Notification", Notification);
      // navigator.permissions.query({ name: "notifications" }) agrees with Notification.permission
      const perms = navigator.permissions;
      if (perms && perms.query) {
        const q = perms.query.bind(perms);
        def(perms, "query", function query(desc) {
          if (desc && desc.name === "notifications") {
            return q(desc).then(st => {
              const v = d.permission();
              const state = v === "default" ? "prompt" : v === "granted" ? "granted" : "denied";
              try { Object.defineProperty(st, "state", { get: () => state, configurable: true }); } catch (e) { }
              return st;
            });
          }
          return q(desc);
        });
      }
    }

    // the browser brand in client hints, as seen from scripts
    const uad = navigator.userAgentData;
    if (uad) {
      const extra = d.brands();   // Drift goes first; the engine's own brands (Chromium and its placeholder) stay
      const proto = Object.getPrototypeOf(uad);
      const base = uad.brands.filter(b => b.brand !== "Drift");
      const brands = () => [...extra.map(b => ({ brand: b.brand, version: b.version })), ...base.map(b => ({ brand: b.brand, version: b.version }))];
      try { Object.defineProperty(proto, "brands", { get: brands, configurable: true }); } catch (e) { }
      const high = proto.getHighEntropyValues;
      if (high) def(proto, "getHighEntropyValues", function getHighEntropyValues(hints) {
        return high.call(this, hints).then(v => {
          v.brands = brands();
          if (v.fullVersionList) v.fullVersionList = [...extra.map(b => ({ brand: b.brand, version: b.full })), ...v.fullVersionList.filter(b => b.brand !== "Drift")];
          return v;
        });
      });
    }
  };
  if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: install });
  else webFrame.executeJavaScript(`(${install})()`);
}

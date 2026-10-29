"use strict";
// Everything a website can ask the user (permissions, page dialogs, sign-in, opening apps, sharing the screen,
// notifications), handled with Drift's own interface.
const { app, ipcMain, session, desktopCapturer } = require("electron");
const D = require("./main");
const { Toast } = require("./popups");

const ses = session.defaultSession;
const originOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : url || ""; } catch { return url || ""; } };
function hostOf(origin) {
  try {
    const u = new URL(origin);
    let h = u.hostname;
    try { h = require("url").domainToUnicode(h) || h; } catch { }
    if (h.startsWith("www.")) h = h.slice(4);
    return u.port ? h + ":" + u.port : h;
  } catch { return origin || ""; }
}

// The engine's names for permissions -> Drift's (the UI's) names. "allow" means no one is asked.
const Kinds = {
  notifications: "notifications", geolocation: "location", "clipboard-read": "clipboard", midiSysex: "midi",
  "window-management": "windows", fileSystem: "files", "idle-detection": "other", unknown: "other",
  fullscreen: "allow", pointerLock: "allow", keyboardLock: "allow", "clipboard-sanitized-write": "allow", midi: "allow",
  "speaker-selection": "allow", "storage-access": "allow", "top-level-storage-access": "allow", mediaKeySystem: "allow",
  "display-capture": "allow", hid: "deny", serial: "deny", usb: "deny",
};

// ---------------- saved answers ----------------

const saved = (origin, kind) => (D.store.Permissions.find(p => p.Origin === origin && p.Kind === kind) || {}).State || null;
function save(origin, kind, state) {
  D.store.Permissions = D.store.Permissions.filter(p => !(p.Origin === origin && p.Kind === kind));
  if (state === "allow" || state === "block") D.store.Permissions.push({ Origin: origin, Kind: kind, State: state });
  D.queueSave();
}

// ---------------- permissions: the prompt bar ----------------

function kindsFor(permission, details) {
  if (permission === "media") {
    // no camera or microphone means it's sharing the screen, which Drift's own picker asks about
    if (!details.mediaTypes || !details.mediaTypes.length) return ["allow"];
    const types = details.mediaTypes;
    return [...new Set(types.map(t => t === "video" ? "camera" : "microphone"))];
  }
  return [Kinds[permission] || "other"];
}

/** Asks in the prompt bar of the tab. `answer(allowed)` is called once the user decides. */
function ask(t, origin, kinds, answer) {
  for (const kind of kinds) {
    let p = t.permissions.find(x => x.origin === origin && x.kind === kind);
    if (!p) t.permissions.push(p = { origin, kind, waiting: [] });
    p.waiting.push(answer);
  }
  if (t === D.active) D.sendNav();
}

ses.setPermissionRequestHandler((wc, permission, callback, details) => {
  if (permission === "openExternal") { openExternal(wc, details, callback); return; }
  const url = details.requestingUrl || (wc && wc.getURL()) || "";
  if (/^(drift|chrome-extension):/.test(url)) { callback(true); return; }   // Drift's own pages and extensions
  const kinds = kindsFor(permission, details);
  if (kinds[0] === "allow") { callback(true); return; }
  if (kinds[0] === "deny") { callback(false); return; }
  const t = D.tabByWc(wc);
  if (!t) { callback(false); return; }
  const origin = originOf(url);
  const states = kinds.map(k => saved(origin, k));
  if (states.includes("block")) { callback(false); return; }
  if (states.every(s => s === "allow")) { callback(true); return; }
  // a request waits for every kind it needs (camera and microphone together)
  let left = kinds.length, ok = true, done = false;
  ask(t, origin, kinds, allowed => {
    if (done) return;
    ok = ok && allowed;
    if (--left === 0 || !allowed) { done = true; callback(ok && allowed); }
  });
});

ses.setPermissionCheckHandler((wc, permission, origin, details) => {
  if (/^(drift|chrome-extension):/.test(origin || "")) return true;
  const kind = Kinds[permission] || (permission === "media" ? (details && details.mediaType === "video" ? "camera" : "microphone") : null);
  if (kind === "allow") return true;
  if (kind === "deny") return false;
  if (!kind) return true;
  return saved(originOf(origin), kind) === "allow";
});

/** allow / block are remembered for the site; dismiss only answers this time. */
D.answerPermissions = (t, origin, decision) => {
  for (const p of t.permissions.filter(x => origin == null || x.origin === origin)) {
    if (decision !== "dismiss") save(p.origin, p.kind, decision === "allow" ? "allow" : "block");
    for (const answer of p.waiting) try { answer(decision === "allow"); } catch { }
    t.permissions.splice(t.permissions.indexOf(p), 1);
  }
  if (t === D.active) D.sendNav();
};

D.promptDto = t => {
  const first = t && t.permissions[0];
  if (!first) return null;
  return {
    origin: first.origin, host: hostOf(first.origin),
    kinds: t.permissions.filter(x => x.origin === first.origin).map(x => x.kind),
    more: t.permissions.filter(x => x.origin !== first.origin).length,
  };
};

D.sendPermissions = () => {
  const sites = new Map();
  const add = (origin, item) => { if (!sites.has(origin)) sites.set(origin, []); sites.get(origin).push(item); };
  for (const p of D.store.Permissions) add(p.Origin, { kind: p.Kind, state: p.State });
  for (const x of D.store.ExternalAllowed) {
    const i = x.lastIndexOf("|");
    if (i > 0) add(x.slice(0, i), { kind: "external:" + x.slice(i + 1), state: "allow" });
  }
  D.send({ type: "permissions", sites: [...sites].sort((a, b) => hostOf(a[0]).localeCompare(hostOf(b[0]))).map(([origin, items]) => ({ origin, host: hostOf(origin), items })) });
};

D.setPermission = (origin, kind, state) => {
  if (!origin || !kind) return;
  if (kind.startsWith("external:")) {
    D.store.ExternalAllowed = D.store.ExternalAllowed.filter(x => x !== origin + "|" + kind.slice(9));
    D.queueSave();
  } else save(origin, kind, state);
  D.sendPermissions();
};

// ---------------- dialogs ----------------

const dialogs = [];   // the first one is on screen
let nextDialog = 0;

/** Shows a Drift dialog (in the UI) and calls answer(ok, text, password, remember, extra) when it's closed. */
function queueDialog(d) {
  d.id = ++nextDialog;
  dialogs.push(d);
  if (dialogs.length === 1) showDialog(d);
  return d;
}
D.queueDialog = queueDialog;

function showDialog(d) {
  if (d.tab && d.tab !== D.active && D.tabs.includes(d.tab)) D.activate(d.tab);
  if (D.win && !D.win.isDestroyed() && d.focus) { if (D.win.isMinimized()) D.win.restore(); D.win.focus(); }
  D.send({ type: "dialog", id: d.id, kind: d.kind, host: hostOf(d.origin), message: d.message, text: d.text, scheme: d.scheme, app: d.app, sources: d.sources });
}

D.answerDialog = (id, ok, text, password, remember, source, audio) => {
  const d = dialogs.find(x => x.id === id);
  if (!d) return;
  const wasShown = dialogs[0] === d;
  dialogs.splice(dialogs.indexOf(d), 1);
  try { d.answer(ok, text, password, remember, { source, audio }); } catch (e) { console.error(e); }
  if (wasShown && dialogs.length) {
    // let the closing dialog finish its animation before the next one opens
    const next = dialogs[0];
    setTimeout(() => { if (dialogs[0] === next) showDialog(next); }, 320);
  }
};

/** A tab is going away (or leaving its page): cancel whatever it was asking. */
D.dropPrompts = (t, dialogsToo) => {
  if (t.permissions.length) D.answerPermissions(t, null, "dismiss");
  if (!dialogsToo) return;
  for (const d of dialogs.filter(x => x.tab === t)) {
    if (dialogs[0] === d) D.send({ type: "dialogGone", id: d.id });
    D.answerDialog(d.id, false, null, null, false);
  }
};

// alert, confirm and prompt: the page waits (its script is paused) until the user answers
ipcMain.on("dialog", (e, m) => {
  const t = D.tabByWc(e.sender);
  const kind = ["alert", "confirm", "prompt"].includes(m && m.kind) ? m.kind : "alert";
  if (!t || !D.tabs.includes(t)) { e.returnValue = kind === "prompt" ? null : false; return; }
  queueDialog({
    tab: t, kind, origin: originOf(e.senderFrame ? e.senderFrame.url : t.url), message: String(m.message || "").slice(0, 5000), text: String(m.text || "").slice(0, 5000),
    answer: (ok, text) => { e.returnValue = kind === "prompt" ? (ok ? text || "" : null) : kind === "alert" ? true : ok; },
  });
});

// ---------------- per tab: sign-in, leaving a page ----------------

D.wirePrompts = t => {
  const wc = t.wc;
  wc.on("login", (e, details, authInfo, callback) => {
    e.preventDefault();
    const origin = authInfo.isProxy ? `${authInfo.scheme}://${authInfo.host}:${authInfo.port}` : originOf(details.url);
    queueDialog({
      tab: t, kind: "auth", origin, message: authInfo.realm || "",
      answer: (ok, user, password) => { if (ok) callback(user || "", password || ""); else callback(); },
    });
  });
  // "Leave site?": asked when a page with unsaved changes is closed or Drift navigates it away
  wc.on("will-prevent-unload", e => {
    if (t.forceLeave) { e.preventDefault(); return; }
    const closing = !D.tabs.includes(t);
    if (!closing && !t.pending) { e.preventDefault(); return; }   // the page itself is navigating; let it
    if (closing) D.unclose(t);
    const retry = t.pending;
    queueDialog({
      tab: t, kind: "leave", origin: originOf(t.url), message: "",
      answer: ok => {
        if (!ok) return;
        t.forceLeave = true;
        setTimeout(() => { t.forceLeave = false; }, 1500);
        if (closing) D.closeTab(t);
        else if (retry) retry();
      },
    });
  });
  wc.on("did-start-navigation", d => { if (d.isMainFrame && !d.isSameDocument) t.pending = null; });
};

// ---------------- opening apps ----------------

function openExternal(wc, details, callback) {
  const url = details.externalURL || "";
  const colon = url.indexOf(":");
  if (colon <= 0) { callback(false); return; }
  const scheme = url.slice(0, colon).toLowerCase();
  if (["javascript", "data", "file", "vbscript"].includes(scheme)) { callback(false); return; }
  const appName = app.getApplicationNameForProtocol(url);
  if (!appName) { callback(false); return; }   // no app on this computer handles it
  const t = D.tabByWc(wc);
  const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || "");
  if (D.store.ExternalAllowed.includes(origin + "|" + scheme)) { callback(true); return; }
  queueDialog({
    tab: t, kind: "external", origin, scheme, app: appName.replace(/\.(exe|desktop)$/i, ""), message: url,
    answer: (ok, _t, _p, remember) => {
      if (ok && remember && origin && !D.store.ExternalAllowed.includes(origin + "|" + scheme)) { D.store.ExternalAllowed.push(origin + "|" + scheme); D.queueSave(); }
      callback(ok);
    },
  });
}

// ---------------- sharing the screen ----------------

ses.setDisplayMediaRequestHandler(async (request, callback) => {
  const wc = request.frame ? require("electron").webContents.fromFrame(request.frame) : null;
  const t = D.tabByWc(wc);
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
  } catch { }
  // Drift's own window isn't something to share
  sources = sources.filter(s => !(D.win && s.id === D.win.getMediaSourceId()));
  if (!sources.length) { callback({}); return; }
  const list = sources.map(s => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null }));
  queueDialog({
    tab: t, kind: "screen", origin: originOf(request.securityOrigin || (t && t.url) || ""), sources: list, message: "", focus: true,
    answer: (ok, _t, _p, _r, extra) => {
      const src = ok && sources.find(s => s.id === extra.source);
      if (!src) { callback({}); return; }
      const out = { video: src };
      if (extra.audio && process.platform === "win32" && request.audioRequested) out.audio = "loopback";
      callback(out);
    },
  });
}, { useSystemPicker: false });

// ---------------- notifications ----------------

const notes = new Map();   // id -> { toast, wc }
let nextNote = 0;
const noteOrigin = e => originOf(e.senderFrame ? e.senderFrame.url : "");

ipcMain.on("note-permission", e => {
  const s = saved(noteOrigin(e), "notifications");
  e.returnValue = s === "allow" ? "granted" : s === "block" ? "denied" : "default";
});

ipcMain.handle("note-request", e => new Promise(resolve => {
  const origin = noteOrigin(e), s = saved(origin, "notifications");
  if (s) { resolve(s === "allow" ? "granted" : "denied"); return; }
  const t = D.tabByWc(e.sender);
  if (!t) { resolve("default"); return; }
  let answered = false;
  ask(t, origin, ["notifications"], allowed => {
    answered = true;
    const now = saved(origin, "notifications");
    resolve(now ? (now === "allow" ? "granted" : "denied") : allowed ? "granted" : "default");
  });
}));

ipcMain.on("note-show", (e, opts) => {
  const origin = noteOrigin(e);
  if (saved(origin, "notifications") !== "allow" || !opts) { e.returnValue = null; return; }
  const wc = e.sender, t = D.tabByWc(wc);
  const id = "n" + ++nextNote;
  e.returnValue = id;
  const key = opts.tag ? origin + "|" + opts.tag : null;
  if (key) for (const old of Toast.all.filter(x => x.key === key)) old.dismiss(false);
  const fire = kind => { if (!wc.isDestroyed()) wc.send("note-event", id, kind); };
  const toast = new Toast(null, {
    key, title: String(opts.title || "").slice(0, 200), body: String(opts.body || "").slice(0, 600), host: hostOf(origin),
    icon: /^(https?|data):/.test(opts.icon || "") ? opts.icon : t && t.favicon, requireInteraction: !!opts.requireInteraction,
  }, {
    onClick: () => {
      fire("click");
      const win = D.win;
      if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      if (t && D.tabs.includes(t)) D.activate(t);
    },
    onClosed: report => { notes.delete(id); if (report) fire("close"); },
  });
  notes.set(id, { toast, wc });
  setTimeout(() => fire("show"), 0);
});

ipcMain.on("note-close", (e, id) => {
  const n = notes.get(id);
  if (n && n.wc === e.sender) n.toast.dismiss(false);
});

ipcMain.on("brands", e => {
  const v = app.getVersion();
  e.returnValue = [{ brand: "Drift", version: v.split(".")[0], full: v }];
});

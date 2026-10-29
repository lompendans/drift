"use strict";
// Drift's main process. A frameless window whose whole interface (sidebar, tabs, address bar, palette) is one web page
// (ui/index.html); pages render in views that the UI positions over its rounded "card".
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, net, nativeTheme, screen, shell, dialog } = require("electron");

const Root = path.join(__dirname, "..");
// DRIFT_DATA points Drift at another data folder (used for testing, so a real profile is never touched)
const DataFolder = process.env.DRIFT_DATA || path.join(app.getPath("appData"), "Drift");
app.setName("Drift");
app.setPath("userData", DataFolder);                               // %AppData%\Drift, ~/.config/Drift: shared with Drift 1.x
app.setPath("sessionData", path.join(DataFolder, "Engine"));       // the engine's own files (cookies, caches, site data)
if (process.platform === "win32") app.setAppUserModelId("Drift");

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
// tests take screenshots while the window sits behind others; keep it painting
if (process.env.DRIFT_TEST_PORT) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

protocol.registerSchemesAsPrivileged([{ scheme: "drift", privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: false } }]);

const { Store, Engines } = require("./store");
const { AdBlocker, Lists } = require("./adblock");
const { T, site: siteOf } = require("./filters");
const { Downloads } = require("./downloads");
const { Updater, DownloadPage } = require("./updater");
const popups = require("./popups");
const i18n = require("../ui/i18n");

const NewTabUrl = "drift://newtab/";
const isNewTab = u => !!u && u.startsWith("drift://newtab");
const displayUrl = u => isNewTab(u) ? "" : u || "";
const isWebUrl = u => !!u && /^https?:\/\//.test(u);

// ---------------- state ----------------

const D = {
  store: Store.load(),
  blocker: new AdBlocker(),
  updater: new Updater(),
  tabs: [],
  closedTabs: [],
  recent: [],                 // most recently used first, for Ctrl+Tab
  thumbs: new Map(),          // small JPEG data URLs of each tab
  win: null,
  ui: null,                   // the UI's webContents
  active: null,
  card: { x: 0, y: 0, w: 0, h: 0, r: 10 },
  uiReady: false, overlayOpen: false, fullscreen: false, userFullscreen: false,
  pageColor: "#ffffff",
  quitting: false,
};
D.downloads = new Downloads(D.store);
module.exports = D;

// The language Drift shows: the user's choice, or the computer's when it's one Drift speaks
const langOf = s => i18n.languages.includes(s.Language) ? s.Language : app.getLocale().toLowerCase().startsWith("tr") ? "tr" : "en";
let L = i18n.make("en");
D.t = (s, vars) => L.T(s, vars);
D.lang = () => L.lang;

let nextTabId = 0;
class Tab {
  constructor(url, title, favicon) {
    this.id = ++nextTabId;
    this.view = null;           // null while the tab is asleep (restored but not opened yet)
    this.url = url;
    this.title = title || "New Tab";
    this.favicon = favicon || null;
    this.loading = false;
    this.pageSite = ""; this.pageHost = ""; this.pageUrl = "";    // the page shown, for first-party checks
    this.exempt = false;        // a list's "@@...$document" rule covers this page
    this.hideOff = 0;           // element hiding turned off by a list: 1 generic, 2 specific
    this.proceedUrl = null;     // badware page the user chose to open anyway
    this.error = null;          // set while the page failed to load; Drift draws its own error card
    this.committed = false;     // a document has loaded (a popup that only downloads never gets one)
    this.downloadAt = 0;
    this.permissions = [];      // waiting for an answer in the prompt bar, one site at a time
    this.blocked = 0;
    this.blockedSites = new Map();
  }
  get wc() { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null; }
}
D.Tab = Tab;

const tabByWc = wc => wc ? D.tabs.find(t => t.wc === wc) || D.parked.get(wc.id) || null : null;
D.tabByWc = tabByWc;
D.parked = new Map();         // closed tabs waiting for their page to agree to close (beforeunload)

let saveTimer = null;
function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 1500); }
D.queueSave = queueSave;

function saveState() {
  clearTimeout(saveTimer);
  const s = D.store;
  s.Session = D.tabs.map(t => ({ Url: t.url, Title: t.title, Favicon: t.favicon }));
  s.ActiveIndex = Math.max(0, D.tabs.indexOf(D.active));
  if (D.win && !D.win.isDestroyed() && !D.fullscreen) {
    const b = D.win.isMaximized() || D.win.isMinimized() ? D.win.getNormalBounds() : D.win.getBounds();
    s.Bounds = [b.x, b.y, b.width, b.height];
    s.BoundsDip = true;
    s.Maximized = D.win.isMaximized();
  }
  s.save();
}
D.saveState = saveState;

function send(msg) { if (D.uiReady && D.ui && !D.ui.isDestroyed()) D.ui.send("host", msg); }
D.send = send;

// ---------------- the window ----------------

function startBounds() {
  const s = D.store, b = s.Bounds;
  if (Array.isArray(b) && b.length === 4 && b[2] > 300 && b[3] > 200) {
    // Drift 1.x saved device pixels; Electron places windows in scaled pixels
    const f = s.BoundsDip ? 1 : screen.getPrimaryDisplay().scaleFactor || 1;
    const r = { x: Math.round(b[0] / f), y: Math.round(b[1] / f), width: Math.round(b[2] / f), height: Math.round(b[3] / f) };
    if (screen.getAllDisplays().some(d => { const a = d.workArea; return r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y; })) return r;
  }
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, a.width - 80), height = Math.min(820, a.height - 60);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height };
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const bg = dark ? "#16171a" : "#edeff2";
  D.pageColor = dark ? "#202124" : "#ffffff";
  const win = D.win = new BrowserWindow(Object.assign(startBounds(), {
    frame: false, show: false, backgroundColor: bg, minWidth: 560, minHeight: 380, title: "Drift",
    icon: path.join(Root, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload-ui.js"), contextIsolation: true, sandbox: true, spellcheck: true },
  }));
  win.setMenu(null);
  D.ui = win.webContents;
  if (D.store.Maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 3000);

  const sendWindow = () => send({ type: "window", maximized: win.isMaximized(), fullscreen: D.fullscreen });
  D.sendWindowState = sendWindow;
  for (const ev of ["maximize", "unmaximize", "restore"]) win.on(ev, () => { sendWindow(); layout(); queueSave(); });
  win.on("resize", () => { layout(); queueSave(); });
  win.on("move", queueSave);
  win.on("blur", () => { if (D.switcherActive) endSwitcher(true); });
  win.on("close", e => {
    const n = D.downloads.activeCount;
    if (n > 0 && !D.quitting) {
      const r = dialog.showMessageBoxSync(win, {
        type: "warning", buttons: [D.t("Close Drift"), D.t("Keep downloading")], defaultId: 1, cancelId: 1, title: "Drift", noLink: true,
        message: D.t(n === 1 ? "A download is still in progress. Close Drift and cancel it?" : `${n} downloads are still in progress. Close Drift and cancel them?`),
      });
      if (r !== 0) { e.preventDefault(); return; }
    }
    saveState();
  });
  win.on("closed", () => { D.win = null; app.quit(); });

  D.ui.on("before-input-event", (e, input) => onKey(e, input));
  D.ui.on("zoom-changed", () => D.ui.setZoomLevel(0));
  D.ui.setVisualZoomLevelLimits(1, 1);
  D.ui.on("context-menu", () => { });   // the UI has its own menus; no engine menu there
  D.ui.setWindowOpenHandler(() => ({ action: "deny" }));
  D.ui.on("will-navigate", e => e.preventDefault());
  win.loadURL("drift://ui/index.html");
}

/** Places the active page's view over the UI's card, with matching rounded corners. */
function layout() {
  const win = D.win;
  if (!win || win.isDestroyed()) return;
  const c = D.card;
  for (const t of D.tabs) {
    if (!t.view) continue;
    const show = t === D.active && !D.overlayOpen && !t.error && (D.fullscreen || c.w > 0);
    if (show) {
      if (D.fullscreen) {
        const [w, h] = win.getContentSize();
        t.view.setBounds({ x: 0, y: 0, width: w, height: h });
        t.view.setBorderRadius(0);
      } else {
        t.view.setBounds({ x: c.x, y: c.y, width: c.w, height: c.h });
        t.view.setBorderRadius(c.r);
      }
    }
    if (t.view.getVisible() !== show) t.view.setVisible(show);
  }
}
D.layout = layout;

function setFullscreen(on, byUser) {
  if (on === D.fullscreen) return;
  D.fullscreen = on;
  D.userFullscreen = on && !!byUser;
  D.win.setFullScreen(on);
  layout();
  D.sendWindowState();
}

// ---------------- startup ----------------

function restoreSession() {
  const migrate = u => {
    if (!u) return null;
    if (u.startsWith("https://drift.local/newtab")) return NewTabUrl;   // Drift 1.x's start page
    if (u.startsWith("https://drift.local/blocked.html")) return u.replace("https://drift.local/blocked.html", "drift://blocked/");
    return u;
  };
  for (const st of D.store.StartupMode === "home" ? [] : D.store.Session || []) {
    const url = migrate(st.Url);
    if (url) D.tabs.push(new Tab(url, st.Title && st.Title.trim() ? st.Title : displayUrl(url), st.Favicon));
  }
  if (!D.tabs.length) D.tabs.push(new Tab(D.store.HomePage || NewTabUrl, D.store.HomePage ? displayUrl(D.store.HomePage) : D.t("New Tab")));
  D.recent.push(...D.tabs);
  activate(D.tabs[Math.max(0, Math.min(D.store.ActiveIndex || 0, D.tabs.length - 1))]);
  // links Drift was started with (from another app, or "Open with")
  for (const u of D.pendingUrls || []) newTab(u, D.active);
  D.pendingUrls = null;
}

// ---------------- tabs ----------------

function newTab(url, after, activateIt = true) {
  const t = new Tab(url || NewTabUrl, url ? displayUrl(url) : D.t("New Tab"));
  D.tabs.splice(after && D.tabs.includes(after) ? D.tabs.indexOf(after) + 1 : D.tabs.length, 0, t);
  if (activateIt) activate(t); else sendTabs();
  queueSave();
  return t;
}
D.newTab = newTab;

function activate(t) {
  D.active = t;
  D.recent.splice(D.recent.indexOf(t) >>> 0, D.recent.includes(t) ? 1 : 0);
  D.recent.unshift(t);
  if (!t.view) wake(t);
  layout();
  if (!D.overlayOpen && t.wc) t.wc.focus();
  if (D.win) D.win.setTitle(t.title + " - Drift");
  sendTabs(); sendNav(); sendShield();
  queueSave();
}
D.activate = activate;

const pagePreferences = () => ({
  preload: path.join(__dirname, "preload-page.js"), contextIsolation: true, sandbox: true, nodeIntegration: false,
  spellcheck: true, session: session.defaultSession,
});

/** Opens a sleeping tab's page; with `webContents`, adopts a page that a site opened (window.open). */
function wake(t, webContents) {
  t.view = new WebContentsView(webContents ? { webContents } : { webPreferences: pagePreferences() });
  t.view.setBackgroundColor(D.pageColor);
  t.view.setVisible(false);
  D.win.contentView.addChildView(t.view);
  wire(t);
  if (!webContents) t.wc.loadURL(t.url || NewTabUrl).catch(() => { });
  if (t === D.active) { layout(); sendNav(); if (!D.overlayOpen) t.wc.focus(); }
}

function wire(t) {
  const wc = t.wc;
  wc.setWindowOpenHandler(d => {
    // ctrl/middle-click: a new tab in the background, without the opener (like Chrome)
    if (d.disposition === "background-tab") { newTab(d.url, t, false); return { action: "deny" }; }
    return {
      action: "allow",
      outlivesOpener: true,
      createWindow: options => {
        const nt = newTab(d.url, t, false);
        nt.url = d.url;
        wake(nt, options.webContents);
        activate(nt);
        return nt.wc;
      },
    };
  });
  wc.on("did-start-navigation", d => {
    if (!d.isMainFrame || d.isSameDocument) return;
    D.dropPrompts(t, false);   // questions from the old page no longer apply
    t.loading = true;
    if (!d.url.startsWith("data:")) t.url = d.url;
    startPage(t, d.url);
    tabChanged(t);
  });
  wc.on("did-redirect-navigation", d => { if (d.isMainFrame) { t.url = d.url; startPage(t, d.url); } });
  wc.on("did-navigate", (_, url, code) => {
    t.url = url;
    t.committed = true;
    if (t.error) { t.error = null; if (t === D.active) layout(); }
    tabChanged(t);
  });
  wc.on("did-navigate-in-page", (_, url, isMain) => { if (isMain) { t.url = url; tabChanged(t); } });
  wc.on("page-title-updated", (_, title) => {
    t.title = isNewTab(wc.getURL()) ? D.t("New Tab") : title && title.trim() ? title : displayUrl(wc.getURL());
    if (t === D.active && D.win) D.win.setTitle(t.title + " - Drift");
    tabChanged(t);
  });
  wc.on("page-favicon-updated", (_, favicons) => { t.favicon = isNewTab(wc.getURL()) ? null : favicons[0] || null; tabChanged(t); });
  wc.on("did-stop-loading", () => {
    t.loading = false;
    if (!t.error && isWebUrl(wc.getURL())) D.store.addHistory(wc.getURL(), wc.getTitle(), t.favicon);
    tabChanged(t);
    queueSave();
    refreshThumbSoon(t);
  });
  wc.on("did-fail-load", (_, code, desc, url, isMain) => {
    if (!isMain) return;
    // a link that turned into a download ends its navigation as failed; that's not an error to show
    if (Date.now() - t.downloadAt < 5000) return;
    const error = errorFor(code, desc, url);
    if (!error) return;
    t.error = error;
    t.title = error.host;
    t.loading = false;
    if (t === D.active) { layout(); if (D.win) D.win.setTitle(t.title + " - Drift"); }
    tabChanged(t);
  });
  wc.on("render-process-gone", (_, details) => {
    if (details.reason === "clean-exit") return;
    let host = ""; try { host = new URL(t.url).host.replace(/^www\./, ""); } catch { }
    t.error = { kind: "unknown", host: host || "This page", url: t.url, code: "RENDERER_" + details.reason.toUpperCase().replace(/-/g, "_") };
    t.loading = false;
    if (t === D.active) layout();
    tabChanged(t);
  });
  wc.on("enter-html-full-screen", () => { if (t === D.active && !D.userFullscreen) setFullscreen(true); });
  wc.on("leave-html-full-screen", () => { if (t === D.active && !D.userFullscreen) setFullscreen(false); });
  wc.on("before-input-event", (e, input) => onKey(e, input));
  wc.on("focus", () => { if (D.switcherActive) { } });
  D.wirePrompts(t);
}

/** A new page in a tab: its own site is first party, and the blocked count starts over. */
function startPage(t, url) {
  let u = null;
  try { u = new URL(url); } catch { }
  const web = !!u && (u.protocol === "http:" || u.protocol === "https:");
  const host = web ? u.hostname.toLowerCase() : "";
  const engine = D.blocker.engine;
  t.pageUrl = url; t.pageHost = host; t.pageSite = web ? siteOf(host) : "";
  t.exempt = web && engine.pageAllowed(url, host);
  t.hideOff = web ? engine.hideOff(url, host) : 0;
  if (t.proceedUrl && t.proceedUrl !== url) t.proceedUrl = null;
  t.blocked = 0;
  t.blockedSites.clear();
  if (t === D.active) sendShield();
}

/** Turns an engine error into what Drift's error card shows, or null for ones it shouldn't (stopped loads, sign-in prompts). */
function errorFor(code, desc, url) {
  if (code === -3 || code === 0) return null;   // aborted: stopped, replaced by another page, or a download
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const online = net.isOnline();
  let kind = "unknown";
  if (code === -105 || code === -137) kind = online ? "dns" : "offline";
  else if (code === -106) kind = "offline";
  else if ([-102, -104, -109, -100, -101, -103, -118].includes(code)) kind = code === -118 ? "timeout" : online ? "connect" : "offline";
  else if (code === -7) kind = "timeout";
  else if (code <= -200 && code > -300) kind = "cert";
  else if (code === -310) kind = "redirect";
  else if (code === -320 || code === -324 || code === -370) kind = "response";
  let host = u.hostname;
  try { host = require("url").domainToUnicode(host) || host; } catch { }
  if (host.startsWith("www.")) host = host.slice(4);
  return { kind, host, url, code: (desc || "").replace(/^net::/, "").replace(/^ERR_/, "") || String(code) };
}

function closeTab(t) {
  const i = D.tabs.indexOf(t);
  if (i < 0) return;
  D.dropPrompts(t, true);
  if (t.url && !isNewTab(t.url)) D.closedTabs.push(t.url);
  D.tabs.splice(i, 1);
  D.recent.splice(D.recent.indexOf(t) >>> 0, D.recent.includes(t) ? 1 : 0);
  D.thumbs.delete(t.id);
  if (D.switcherActive) endSwitcher(true);
  if (t.view) {
    t.view.setVisible(false);
    const wc = t.wc;
    if (wc) {
      // the page gets a chance to ask "Leave site?" (see will-prevent-unload in prompts.js)
      t.closingIndex = i;
      D.parked.set(wc.id, t);
      wc.once("destroyed", () => { D.parked.delete(wc.id); removeView(t); });
      wc.close({ waitForBeforeUnload: true });
    } else removeView(t);
  }
  if (!D.tabs.length) { D.win.close(); return; }
  if (t === D.active) activate(D.tabs[Math.min(i, D.tabs.length - 1)]);
  else sendTabs();
  queueSave();
}
D.closeTab = closeTab;

function removeView(t) {
  if (!t.view) return;
  try { if (D.win && !D.win.isDestroyed()) D.win.contentView.removeChildView(t.view); } catch { }
  t.view = null;
}

/** The page said "Stay": put a tab that was closing back where it was. */
D.unclose = t => {
  if (D.tabs.includes(t)) return;
  if (t.wc) D.parked.delete(t.wc.id);
  if (D.closedTabs[D.closedTabs.length - 1] === t.url) D.closedTabs.pop();
  D.tabs.splice(Math.min(t.closingIndex ?? D.tabs.length, D.tabs.length), 0, t);
  activate(t);
};

D.closeDownloadTab = t => {
  if (t.committed || !D.tabs.includes(t) || D.tabs.length < 2) return;
  if (t === D.active) { const back = D.recent.find(x => x !== t && D.tabs.includes(x)); if (back) activate(back); }
  closeTab(t);
  D.closedTabs.pop();   // nothing worth reopening
};

function reopenClosedTab() { if (D.closedTabs.length) newTab(D.closedTabs.pop(), D.active); }

function cycleTab(d) {
  if (D.tabs.length < 2 || !D.active) return;
  activate(D.tabs[(D.tabs.indexOf(D.active) + d + D.tabs.length) % D.tabs.length]);
}

function go(input, newTabToo) {
  const url = resolve(input);
  if (!url) { if (newTabToo) newTab(null); return; }
  if (newTabToo || !D.active) { newTab(url); return; }
  navigate(D.active, url);
}
D.go = go;

function navigate(t, url) {
  t.url = url;
  if (t.wc) {
    t.pending = () => t.wc && t.wc.loadURL(url).catch(() => { });
    t.pending();
  } else if (!t.view) wake(t);
}
D.navigate = navigate;

function resolve(input) {
  input = (input || "").trim();
  if (!input) return null;
  if (/^(https?|file|about|view-source|chrome-extension|drift):/i.test(input)) {
    try { new URL(input); return input; } catch { }
  }
  const hasSpace = input.includes(" ");
  const hostLike = !hasSpace && (input.startsWith("localhost") || /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)+(:\d+)?(\/.*)?$/u.test(input) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(input));
  if (hostLike) return (input.startsWith("localhost") || /^\d/.test(input) ? "http://" : "https://") + input;
  return D.store.searchUrl + encodeURIComponent(input);
}
D.resolve = resolve;

function goHome() { go(D.store.HomePage || NewTabUrl, false); }

function back(t) { const wc = t && t.wc; if (wc && wc.navigationHistory.canGoBack()) { t.pending = () => wc.navigationHistory.goBack(); t.pending(); } }
function forward(t) { const wc = t && t.wc; if (wc && wc.navigationHistory.canGoForward()) { t.pending = () => wc.navigationHistory.goForward(); t.pending(); } }
function reload(t) { const wc = t && t.wc; if (wc) { t.pending = () => wc.reload(); if (t.error) { t.error = null; layout(); } t.pending(); } else if (t && !t.view) wake(t); }

// ---------------- messages: host -> UI ----------------

const tabDto = t => ({ id: t.id, title: t.title, url: displayUrl(t.url), favicon: t.favicon, loading: t.loading, asleep: !t.view });
function sendTabs() { send({ type: "tabs", active: D.active ? D.active.id : 0, tabs: D.tabs.map(tabDto) }); }
D.sendTabs = sendTabs;
function tabChanged(t) { if (!D.tabs.includes(t)) return; send({ type: "tab", tab: tabDto(t) }); if (t === D.active) sendNav(); }
D.tabChanged = tabChanged;

function sendNav() {
  const t = D.active, wc = t && t.wc;
  send({
    type: "nav", url: displayUrl(t && t.url),
    canBack: !!wc && wc.navigationHistory.canGoBack(), canForward: !!wc && wc.navigationHistory.canGoForward(),
    loading: !!t && t.loading, error: t ? t.error : null, prompt: D.promptDto(t), bookmarked: D.isBookmarked(t),
    store: D.storeInfo(t && t.url),
  });
}
D.sendNav = sendNav;

const onOff = v => v ? "on" : "off";
function sendSettings() {
  const s = D.store;
  send({ type: "settings", engine: s.SearchEngine, theme: s.Theme, sidebarCollapsed: !!s.SidebarCollapsed, home: s.HomePage || "",
    adblock: onOff(s.AdblockEnabled), version: process.versions.chrome, drift: app.getVersion(),
    lang: s.Language || "system", accent: s.Accent, density: s.Density, homeButton: onOff(s.ShowHomeButton), startup: s.StartupMode,
    startClock: onOff(s.StartClock), startShortcuts: onOff(s.StartShortcuts), startBg: s.StartBackground, customShortcuts: Array.isArray(s.Shortcuts) });
}

// ---------------- start page ----------------

const startDto = () => {
  const s = D.store;
  return { type: "topSites", sites: s.shortcuts(), custom: Array.isArray(s.Shortcuts), engine: s.SearchEngine,
    accent: s.Accent, clock: s.StartClock, shortcuts: s.StartShortcuts, background: s.StartBackground };
};
function sendStart() {
  for (const t of D.tabs) if (t.wc && !t.wc.isDestroyed() && isNewTab(t.wc.getURL())) t.wc.send("page", startDto());
}

/** Keeps a list the start page sent: web addresses only, at most 12, names trimmed. */
function cleanShortcuts(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const it of items.slice(0, 12)) {
    if (!it || typeof it.url !== "string") continue;
    const url = resolve(it.url.trim());
    if (!url || !/^https?:\/\//.test(url) || url.startsWith(D.store.searchUrl)) continue;
    out.push({ Name: typeof it.name === "string" ? it.name.trim().slice(0, 60) : "", Url: url });
  }
  return out;
}

/** After the language changes: everything Drift draws itself loads again in the new language. */
function relanguage() {
  const next = langOf(D.store);
  if (next === L.lang) return false;
  L = i18n.make(next);
  for (const t of D.tabs) if (t.wc && !t.wc.isDestroyed() && t.wc.getURL().startsWith("drift://")) t.wc.reload();
  // the page shows again so Settings can reopen over a fresh picture of it
  if (D.active && D.active.view) D.active.view.setVisible(true);
  D.overlayOpen = false;
  if (D.ui && !D.ui.isDestroyed()) { D.uiReady = false; D.reopenSettings = true; D.ui.reload(); }
  return true;
}

const sendPalette = mode => send({ type: "palette", mode });

// ---------------- messages: UI -> host ----------------

ipcMain.on("host", (e, m) => {
  if (popups.dispatch(e, m)) return;
  if (!D.ui || e.sender !== D.ui || !m || typeof m !== "object") return;
  try { onUiMessage(m); } catch (err) { console.error(err); }
});

function onUiMessage(m) {
  const str = k => typeof m[k] === "string" ? m[k] : null;
  const int = k => typeof m[k] === "number" ? Math.round(m[k]) : 0;
  const bool = k => m[k] === true;
  const byId = () => D.tabs.find(x => x.id === int("id"));
  const s = D.store, a = D.active;
  switch (m.type) {
    case "ready":
      D.uiReady = true;
      sendSettings(); D.sendWindowState(); sendDownloads(); send(D.updater.dto()); D.sendExtensions();
      if (!D.tabs.length) restoreSession(); else { sendTabs(); sendNav(); }
      if (D.reopenSettings) { D.reopenSettings = false; sendPalette("settings"); }
      break;
    case "rect": D.card = { x: int("x"), y: int("y"), w: int("w"), h: int("h"), r: int("r") }; layout(); break;
    case "colors":
      if (str("bg")) D.win.setBackgroundColor(cssColor(str("bg")));
      if (str("page")) { D.pageColor = cssColor(str("page")); for (const t of D.tabs) if (t.view) t.view.setBackgroundColor(D.pageColor); }
      break;
    case "go":
      if (bool("search") && str("input") && str("input").trim()) go(s.searchUrl + encodeURIComponent(str("input").trim()), bool("newTab"));
      else go(str("input"), bool("newTab"));
      break;
    case "activate": { const t = byId(); if (t) activate(t); break; }
    case "close": { const t = byId(); if (t) closeTab(t); break; }
    case "reorder":
      if (Array.isArray(m.ids)) {
        const sorted = m.ids.map(id => D.tabs.find(t => t.id === id)).filter(Boolean);
        if (sorted.length === D.tabs.length) { D.tabs.splice(0, D.tabs.length, ...sorted); queueSave(); }
        sendTabs();
      }
      break;
    case "back": back(a); break;
    case "forward": forward(a); break;
    case "reload": reload(a); break;
    case "home": goHome(); break;
    case "stop": if (a && a.wc) a.wc.stop(); break;
    case "reopen": reopenClosedTab(); break;
    case "min": D.win.minimize(); break;
    case "max": if (D.win.isMaximized()) D.win.unmaximize(); else D.win.maximize(); break;
    case "closeWindow": D.win.close(); break;
    case "drag": break;   // dragging is native here: the UI marks its draggable areas with -webkit-app-region
    case "overlayOpen": openOverlay(); break;
    case "switcherMove": if (D.switcherActive) moveSwitcher(int("dir")); break;
    case "switcherPick": if (D.switcherActive && int("index") >= 0 && int("index") < D.switcherList.length) { D.switcherSel = int("index"); endSwitcher(false); } break;
    case "switcherCommit": if (D.switcherActive) endSwitcher(false); break;
    case "switcherCancel": if (D.switcherActive) endSwitcher(true); break;
    case "getHistory": sendHistory(); break;
    case "getDownloads": sendDownloads(); break;
    case "toggleBookmark": D.toggleBookmark(); break;
    case "getExtensions": D.sendExtensions(); break;
    case "extInstall": D.installFromStore(str("link")); break;
    case "extLoadFolder": D.loadUnpacked(); break;
    case "extEnable": D.setExtensionEnabled(str("id"), bool("on")); break;
    case "extRemove": D.removeExtension(str("id")); break;
    case "extPin": D.pinExtension(str("id"), bool("on")); break;
    case "extOpen": D.openExtensionPopup(str("id"), int("x"), int("y"), int("w"), int("h")); break;
    case "extOptions": D.openExtensionOptions(str("id")); break;
    case "getBookmarks": D.sendBookmarks(); break;
    case "bookmarkDelete":
      s.Bookmarks = s.Bookmarks.filter(b => !(b.Url === str("url") && (b.Folder || "") === (str("folder") || "")));
      queueSave(); sendNav();
      break;
    case "getImport": D.sendImportSources(bool("refresh")); break;
    case "import": D.runImport(str("id"), bool("history"), bool("bookmarks")); break;
    case "checkUpdate": D.updater.check(); break;
    case "applyUpdate": if (D.updater.apply(true)) { D.quitting = true; D.win.close(); } break;
    case "openDownloadPage": newTab(DownloadPage, a); break;
    case "permission": if (a) D.answerPermissions(a, str("origin"), str("decision")); break;
    case "dialogReply": D.answerDialog(int("id"), bool("ok"), str("text"), str("password"), bool("remember"), str("source"), bool("audio")); break;
    case "getPermissions": D.sendPermissions(); break;
    case "permSet": D.setPermission(str("origin"), str("kind"), str("state")); break;
    case "download": {
      const again = D.downloads.do(str("action"), str("id"));
      if (again) session.defaultSession.downloadURL(again);
      sendDownloads();
      break;
    }
    case "downloadsFolder": fs.mkdirSync(D.downloads.folder, { recursive: true }); shell.openPath(D.downloads.folder); break;
    case "getInfo": sendInfo(); break;
    case "getShield": sendShieldDetails(); break;
    case "shieldAllow":
      if (a && a.pageSite) {
        s.AdblockAllowed = s.AdblockAllowed.filter(x => x !== a.pageSite);
        if (bool("allow")) s.AdblockAllowed.push(a.pageSite);
        queueSave();
        applyBlockingChange();
      }
      break;
    case "getFilters": sendFilters(); break;
    case "filterToggle": {
      const list = [...enabledLists()], id = str("id");
      if (Lists.some(l => l.id === id)) {
        const next = list.filter(x => x !== id);
        if (bool("on")) next.push(id);
        s.FilterLists = next;
        queueSave();
        D.blocker.refresh(enabledLists(), false);
      }
      sendFilters();
      break;
    }
    case "filtersUpdate": D.blocker.refresh(enabledLists(), true); break;
    case "openDataFolder": fs.mkdirSync(Store.folder, { recursive: true }); shell.openPath(Store.folder); break;
    case "historyDelete": s.History = s.History.filter(h => h.Url !== str("url")); queueSave(); break;
    case "historyClear": {
      const now = new Date();
      const since = str("range") === "hour" ? Date.now() - 3600e3 : str("range") === "day" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : -Infinity;
      s.History = s.History.filter(h => new Date(h.Last).getTime() < since);
      queueSave(); sendHistory();
      break;
    }
    case "openUrl": go(str("url"), bool("newTab")); break;
    case "hideContent": if (a && a.view) a.view.setVisible(false); D.overlayOpen = true; D.ui.focus(); break;
    case "showContent": D.overlayOpen = false; layout(); if (a && a.wc) a.wc.focus(); break;
    case "sidebar": s.SidebarCollapsed = bool("collapsed"); queueSave(); break;
    case "setting": {
      const value = str("value"), key = str("key");
      if (key === "engine" && value && Engines[value]) s.SearchEngine = value;
      if (key === "home") {
        // empty means Drift's start page; anything else must resolve to a real web address
        const home = resolve(value);
        s.HomePage = !value || !value.trim() || isNewTab(home) ? "" : home && /^https?:/.test(home) && !home.startsWith(s.searchUrl) ? home : s.HomePage;
      }
      if (key === "adblock" && (value === "on" || value === "off")) { s.AdblockEnabled = value === "on"; applyBlockingChange(); }
      if (key === "theme" && ["system", "light", "dark"].includes(value)) { s.Theme = value; nativeTheme.themeSource = value; }
      if (key === "accent" && ["teal", "blue", "purple", "pink", "orange", "graphite"].includes(value)) s.Accent = value;
      if (key === "density" && ["comfortable", "compact"].includes(value)) s.Density = value;
      if (key === "homeButton") s.ShowHomeButton = value === "on";
      if (key === "startup" && ["restore", "home"].includes(value)) s.StartupMode = value;
      if (key === "startClock") s.StartClock = value === "on";
      if (key === "startShortcuts") s.StartShortcuts = value === "on";
      if (key === "startBg" && ["glow", "plain"].includes(value)) s.StartBackground = value;
      if (key === "shortcuts" && value === "reset") s.Shortcuts = null;
      queueSave();
      if (key === "lang" && ["system", ...i18n.languages].includes(value)) { s.Language = value; if (relanguage()) break; }
      sendSettings();
      if (["accent", "startClock", "startShortcuts", "startBg", "shortcuts", "engine"].includes(key)) sendStart();
      break;
    }
  }
}

function cssColor(css) {
  const n = (css.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) return "#000000";
  return "#" + n.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Freezes a picture of the page so the UI can blur it behind the palette. */
async function openOverlay() {
  if (D.switcherActive) endSwitcher(true);
  D.overlayOpen = true;
  const data = await captureTab(D.active);
  if (D.active && D.active.view) D.active.view.setVisible(false);
  const s = D.store;
  send({
    type: "snapshot", data,
    history: s.suggestions(),
    bookmarks: s.Bookmarks.slice(0, 3000).map(b => ({ url: b.Url, title: b.Title, favicon: b.Favicon })),
    tabs: D.tabs.map(tabDto),
    current: displayUrl(D.active && D.active.url),
  });
}

// Messages from pages. Websites may only ask for ad-hiding rules; everything else must come from Drift's own pages.
ipcMain.on("page", (e, m) => {
  const t = tabByWc(e.sender);
  if (!t || !m || typeof m !== "object") return;
  const source = e.senderFrame ? e.senderFrame.url : "";
  if (m.type === "drift-hide") { answerHideRequest(t, m, source, e.senderFrame); return; }
  if (!source.startsWith("drift://")) return;
  if (m.type === "hello") e.sender.send("page", startDto());
  else if (m.type === "setShortcuts") {
    const list = cleanShortcuts(m.items);
    if (list) { D.store.Shortcuts = list; queueSave(); sendStart(); sendSettings(); }
  }
  else if (m.type === "go" && typeof m.input === "string") { const url = resolve(m.input); if (url) navigate(t, url); }
  else if (m.type === "palette") sendPalette("current");
  else if (m.type === "proceed" && typeof m.url === "string" && /^https?:\/\//.test(m.url)) {
    // "Continue anyway" on the badware warning: open that exact address once
    t.proceedUrl = m.url;
    navigate(t, m.url);
  } else if (m.type === "back") {
    if (t.wc && t.wc.navigationHistory.canGoBack()) back(t); else goHome();
  }
});

// ---------------- thumbnails ----------------

/** Captures the visible tab: returns a full-size picture and keeps a small one for Ctrl+Tab. */
async function captureTab(t) {
  const wc = t && t.wc;
  if (!wc || !t.view.getVisible()) return null;
  try {
    const img = await wc.capturePage();
    if (img.isEmpty()) return null;
    const size = img.getSize();
    D.thumbs.set(t.id, img.resize({ width: Math.min(480, size.width), quality: "good" }).toDataURL());
    return "data:image/jpeg;base64," + img.toJPEG(85).toString("base64");
  } catch { return null; }
}

async function refreshThumbSoon(t) {
  await new Promise(r => setTimeout(r, 900));   // let the page paint first
  if (t === D.active && !D.overlayOpen) await captureTab(t);
}

setInterval(() => { if (D.win && D.win.isFocused() && !D.overlayOpen && D.active) captureTab(D.active); }, 6000);

// ---------------- Ctrl+Tab switcher ----------------
// Works like Alt+Tab: tabs in most-recently-used order, Tab moves, releasing Ctrl switches.
// A quick tap switches straight away; the overlay only appears if Ctrl is held a moment.

D.switcherActive = false; D.switcherShown = false; D.switcherSel = 0; D.switcherList = []; let switcherToken = 0;

async function switcher(dir) {
  if (D.switcherActive) { moveSwitcher(dir); return; }
  if (D.overlayOpen || D.tabs.length < 2) return;
  D.switcherActive = true;
  D.switcherShown = false;
  const token = ++switcherToken;
  D.switcherList = D.recent.filter(t => D.tabs.includes(t));
  D.switcherSel = dir > 0 ? 1 : D.switcherList.length - 1;
  const started = Date.now();
  D.overlayOpen = true;
  const snapshot = await captureTab(D.active);
  if (token !== switcherToken || !D.switcherActive) return;
  const wait = 120 - (Date.now() - started);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (token !== switcherToken || !D.switcherActive) return;
  D.switcherShown = true;
  if (D.active && D.active.view) D.active.view.setVisible(false);
  D.ui.focus();
  send({
    type: "switcher", snapshot, sel: D.switcherSel,
    tabs: D.switcherList.map(t => ({ id: t.id, title: t.title, url: displayUrl(t.url), favicon: t.favicon, thumb: D.thumbs.get(t.id) || null })),
  });
}

function moveSwitcher(dir) {
  const n = D.switcherList.length;
  if (!n) return;
  D.switcherSel = ((D.switcherSel + Math.sign(dir)) % n + n) % n;
  if (D.switcherShown) send({ type: "switcherSel", sel: D.switcherSel });
}

function endSwitcher(cancel) {
  if (!D.switcherActive) return;
  D.switcherActive = false;
  switcherToken++;
  const target = cancel || D.switcherSel >= D.switcherList.length ? null : D.switcherList[D.switcherSel];
  if (D.switcherShown) send({ type: "switcherClose", commit: !!target && target !== D.active, sel: D.switcherSel });   // UI animates, then sends showContent
  else { D.overlayOpen = false; layout(); }
  D.switcherShown = false;
  if (target && D.tabs.includes(target)) activate(target);
}

// ---------------- ad blocker ----------------

function enabledLists() { return new Set(D.store.FilterLists || Lists.filter(l => l.defaultOn).map(l => l.id)); }
const isWebPage = t => !!t && isWebUrl(t.url);
const blockingOn = t => D.store.AdblockEnabled && isWebPage(t) && !t.exempt && !D.store.AdblockAllowed.includes(t.pageSite);

const TypeOf = {
  subFrame: T.Subdocument, stylesheet: T.Stylesheet, script: T.Script, image: T.Image, font: T.Font, object: T.Other, xhr: T.Xhr,
  ping: T.Ping, cspReport: T.Ping, media: T.Media, webSocket: T.Websocket,
};
const Empty = {
  script: "data:application/javascript;base64,", image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  other: "data:text/plain;base64,",
};

function installBlocking(ses) {
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (d, callback) => {
    try { callback(filterRequest(d) || {}); } catch { callback({}); }
  });
  // say "Drift" in the client hints too, so sites see the same browser as in the user agent
  ses.webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (d, callback) => {
    const h = d.requestHeaders;
    for (const k of Object.keys(h)) {
      const low = k.toLowerCase();
      if (low === "sec-ch-ua" && !h[k].includes("Drift")) h[k] = `"Drift";v="${app.getVersion().split(".")[0]}", ` + h[k];
      else if (low === "sec-ch-ua-full-version-list" && !h[k].includes("Drift")) h[k] = `"Drift";v="${app.getVersion()}", ` + h[k];
    }
    callback({ requestHeaders: h });
  });
}

/** Decides one request: null to let it through, or { cancel } / { redirectURL }. */
function filterRequest(d) {
  const wc = d.webContents;
  const t = tabByWc(wc);
  if (!t) return null;
  const s = D.store, engine = D.blocker.engine;
  if (d.resourceType === "mainFrame") {
    // pages on the badware list are stopped before they open; tracking parameters are removed
    let u; try { u = new URL(d.url); } catch { return null; }
    const host = u.hostname.toLowerCase(), site = siteOf(host);
    if (!s.AdblockEnabled || s.AdblockAllowed.includes(site) || engine.pageAllowed(d.url, host)) return null;
    const bad = t.proceedUrl === d.url ? null : engine.matchDocument(d.url, host);
    if (bad) {
      const list = (Lists.find(l => l.id === bad.list) || {}).name || "Your filter lists";
      return { redirectURL: "drift://blocked/#" + encodeURIComponent(JSON.stringify({ url: d.url, host, list })) };
    }
    const clean = engine.cleanUrl(d.url, host);
    if (clean && clean !== d.url) return { redirectURL: clean };
    return null;
  }
  if (!blockingOn(t) || d.url === t.pageUrl) return null;
  let u; try { u = new URL(d.url); } catch { return null; }
  const site = siteOf(u.hostname);
  const type = TypeOf[d.resourceType] || T.Other;
  const rule = engine.matchRequest(d.url, u.hostname, t.pageHost, site !== t.pageSite, type);
  if (!rule) return null;
  t.blocked++;
  t.blockedSites.set(site, (t.blockedSites.get(site) || 0) + 1);
  s.AdsBlockedTotal++;
  if (t === D.active) queueShield();
  // "redirect" rules expect a harmless empty file rather than an error
  if (rule.redirect && (type === T.Script || type === T.Image)) return { redirectURL: type === T.Script ? Empty.script : Empty.image };
  return { cancel: true };
}

let shieldTimer = null;
function queueShield() { if (!shieldTimer) shieldTimer = setTimeout(() => { shieldTimer = null; sendShield(); queueSave(); }, 300); }

/** The page script reports class and id names as the page builds itself; answer with the hiding rules that can apply. */
function answerHideRequest(t, m, source, frame) {
  if (!blockingOn(t) || t.hideOff === 3) return;
  let su; try { su = new URL(source); } catch { return; }
  if (su.hostname.toLowerCase() !== t.pageHost || !frame || frame !== t.wc.mainFrame) return;
  const names = k => Array.isArray(m[k]) ? m[k].filter(x => typeof x === "string").slice(0, 5000) : [];
  const css = D.blocker.engine.hideCss(t.pageHost, names("c"), names("i"), m.first === true, (t.hideOff & 1) === 0, (t.hideOff & 2) === 0);
  if (css) t.wc.insertCSS(css, { cssOrigin: "user" }).catch(() => { });
}

/** After the on/off switch or a site's allow setting changes: reload so the change shows. */
function applyBlockingChange() {
  if (isWebPage(D.active) && D.active.wc) D.active.wc.reload();
  sendShield(); sendShieldDetails(); sendFilters();
}

const shieldState = t => !isWebPage(t) ? "none" : !D.store.AdblockEnabled ? "off" : D.store.AdblockAllowed.includes(t.pageSite) || t.exempt ? "allowed" : "on";
function sendShield() { send({ type: "shield", state: shieldState(D.active), count: D.active ? D.active.blocked : 0 }); }
D.sendShield = sendShield;

function sendShieldDetails() {
  const a = D.active, e = D.blocker.engine;
  send({
    type: "shieldDetails", state: shieldState(a), site: a ? a.pageSite : "", count: a ? a.blocked : 0,
    sites: [...(a ? a.blockedSites : new Map())].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([site, count]) => ({ site, count })),
    total: D.store.AdsBlockedTotal, rules: e.totalRules, lists: enabledLists().size,
  });
}

function sendFilters() {
  const enabled = enabledLists(), e = D.blocker.engine, st = D.blocker.status;
  send({
    type: "filters", enabled: D.store.AdblockEnabled, busy: D.blocker.busy, rules: e.totalRules, network: e.networkRules, cosmetic: e.cosmeticRules,
    lists: Lists.map(l => ({ id: l.id, name: l.name, group: l.group, on: enabled.has(l.id), rules: st[l.id].rules, state: st[l.id].state, updated: st[l.id].updated ? new Date(st[l.id].updated).toISOString() : null })),
  });
}

D.blocker.onChanged = () => { sendFilters(); if (D.overlayOpen) sendShieldDetails(); };

// ---------------- info ----------------

const startedAt = Date.now();

function systemName() {
  if (process.platform === "win32") {
    const build = Number(os.release().split(".")[2]) || 0;
    return `${build >= 22000 ? "Windows 11" : "Windows 10"} (build ${process.getSystemVersion()})`;
  }
  if (process.platform === "linux") {
    try {
      const m = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8"));
      if (m) return `${m[1]} (Linux ${os.release()})`;
    } catch { }
    return `Linux ${os.release()}`;
  }
  return `${os.type()} ${process.getSystemVersion()}`;
}

function sendInfo() {
  // memory: Drift plus every engine process it started (pages, GPU, utilities)
  let kb = 0, n = 0;
  for (const p of app.getAppMetrics()) { kb += (p.memory.privateBytes || p.memory.workingSetSize || 0); n++; }
  const s = D.store, e = D.blocker.engine;
  send({
    type: "info", version: app.getVersion(), engine: process.versions.chrome, chromium: process.versions.chrome.split(".")[0],
    sdk: process.versions.electron, userAgent: session.defaultSession.getUserAgent(), windows: systemName(),
    arch: `${os.arch() === "x64" ? "64-bit" : os.arch() === "arm64" ? "64-bit" : "32-bit"} (${os.arch()})`, dotnet: process.versions.node,
    tabs: D.tabs.length, asleep: D.tabs.filter(t => !t.view).length, history: s.History.length,
    memoryMb: Math.round(kb / 1024), engineProcesses: Math.max(0, n - 1), uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    dataFolder: Store.folder, engineName: s.SearchEngine,
    adblock: s.AdblockEnabled ? `On · ${e.totalRules.toLocaleString("en-US")} rules from ${enabledLists().size} lists · ${s.AdsBlockedTotal.toLocaleString("en-US")} blocked so far` : "Off",
    home: s.HomePage || "Drift start page",
  });
}

// ---------------- history and downloads ----------------

function sendHistory() {
  send({ type: "historyList", items: [...D.store.History].sort((a, b) => new Date(b.Last) - new Date(a.Last)).slice(0, 3000).map(h => ({ url: h.Url, title: h.Title, favicon: h.Favicon, last: h.Last })) });
}

function sendDownloads() { send({ type: "downloads", items: D.downloads.dto() }); }
let downloadsTimer = null;
D.downloads.onChanged = important => {
  if (important) queueSave();
  if (!downloadsTimer) downloadsTimer = setTimeout(() => { downloadsTimer = null; sendDownloads(); }, 250);
};
D.downloads.onStarted = d => send({ type: "downloadStarted", id: d.Id });

// ---------------- keyboard ----------------
// Each web view (pages and the UI) reports key presses before the page sees them; this one table says what a key does.

function shortcutFor(input) {
  const k = input.key, ctrl = input.control || input.meta, shift = input.shift, alt = input.alt;
  const key = k.length === 1 ? k.toLowerCase() : k;
  if (ctrl && !alt) {
    if (!shift) switch (key) {
      case "t": return () => sendPalette("newtab");
      case "l": return () => sendPalette("current");
      case "k": return () => sendPalette("search");
      case ",": return () => sendPalette("settings");
      case "w": case "F4": return () => { if (D.active) closeTab(D.active); };
      case "Tab": return () => switcher(1);
      case "PageDown": return () => cycleTab(1);
      case "PageUp": return () => cycleTab(-1);
      case "h": return () => sendPalette("history");
      case "j": return () => sendPalette("downloads");
      case "d": return () => D.toggleBookmark();
      case "b": return () => send({ type: "toggleSidebar" });
      case "r": return () => reload(D.active);
      case "p": return () => { if (D.active && D.active.wc) D.active.wc.print(); };
      case "=": case "+": return () => zoom(1);
      case "-": return () => zoom(-1);
      case "0": return () => zoom(0);
      case "9": return () => { if (D.tabs.length) activate(D.tabs[D.tabs.length - 1]); };
    }
    if (!shift && key >= "1" && key <= "8") { const i = +key - 1; return () => { if (i < D.tabs.length) activate(D.tabs[i]); }; }
    if (shift) switch (key) {
      case "t": return reopenClosedTab;
      case "Tab": return () => switcher(-1);
      case "o": return () => sendPalette("bookmarks");
      case "+": case "=": return () => zoom(1);
    }
  }
  if (alt && !ctrl && !shift) switch (key) {
    case "d": return () => sendPalette("current");
    case "ArrowLeft": return () => back(D.active);
    case "ArrowRight": return () => forward(D.active);
    case "Home": return goHome;
  }
  if (!ctrl && !alt && !shift) switch (key) {
    case "F5": return () => reload(D.active);
    case "F6": return () => sendPalette("current");
    case "F11": return () => setFullscreen(!D.fullscreen, true);
    case "BrowserBack": return () => back(D.active);
    case "BrowserForward": return () => forward(D.active);
    case "BrowserHome": return goHome;
    case "Escape": if (D.fullscreen && D.userFullscreen) return () => setFullscreen(false); return null;
  }
  return null;
}

function zoom(d) {
  const wc = D.active && D.active.wc;
  if (!wc) return;
  wc.setZoomLevel(d === 0 ? 0 : Math.max(-4, Math.min(5, wc.getZoomLevel() + d * 0.5)));
}

function onKey(e, input) {
  // releasing Ctrl finishes a Ctrl+Tab switch, wherever focus happens to be
  if (D.switcherActive && input.type === "keyUp" && (input.key === "Control" || input.key === "Meta")) { endSwitcher(false); return; }
  if (input.type !== "keyDown") return;
  const action = shortcutFor(input);
  if (!action) return;
  e.preventDefault();
  // holding Ctrl+W shouldn't close every tab
  if (!input.isAutoRepeat || input.key === "Tab") setImmediate(action);
}

// ---------------- app ----------------

D.storeInfo = url => require("./main-extensions").storeInfo(url);

app.on("second-instance", (_, argv) => {
  const win = D.win;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const urls = argv.slice(1).filter(a => /^(https?|file):/i.test(a));
  for (const u of urls) newTab(u, D.active);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { D.quitting = true; });
app.on("will-quit", () => { saveState(); D.updater.apply(false); });

app.whenReady().then(() => {
  L = i18n.make(langOf(D.store));
  nativeTheme.themeSource = ["light", "dark"].includes(D.store.Theme) ? D.store.Theme : "system";
  const ses = session.defaultSession;
  const ua = `Mozilla/5.0 (${uaPlatform()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36 Drift/${app.getVersion()}`;
  app.userAgentFallback = ua;
  ses.setUserAgent(ua);
  protocol.handle("drift", req => serveDrift(req));
  installBlocking(ses);
  require("./prompts");
  require("./contextmenu");
  require("./main-extensions").install();
  require("./main-library");
  createWindow();
  D.blocker.refresh(enabledLists(), false);
  D.updater.onChanged = () => send(D.updater.dto());
  setTimeout(() => D.updater.check(), 8000);
  setInterval(() => D.updater.check(), 6 * 3600e3);
  if (process.env.DRIFT_TEST_PORT && !app.isPackaged) require("../test/testhook")(D, +process.env.DRIFT_TEST_PORT);
  const firstUrls = process.argv.slice(1).filter(a => /^(https?|file):/i.test(a));
  if (firstUrls.length) D.pendingUrls = firstUrls;
});

function uaPlatform() {
  if (process.platform === "win32") return "Windows NT 10.0; Win64; x64";
  if (process.platform === "darwin") return "Macintosh; Intel Mac OS X 10_15_7";
  return "X11; Linux x86_64";
}

// drift://ui/… is the interface, drift://newtab/ the start page, drift://blocked/ the badware warning.
function serveDrift(req) {
  let u;
  try { u = new URL(req.url); } catch { return new Response("Not found", { status: 404 }); }
  const map = { ui: ["ui", u.pathname], newtab: ["pages", "/newtab.html"], blocked: ["pages", "/blocked.html"], pages: ["pages", u.pathname] }[u.hostname];
  if (!map) return new Response("Not found", { status: 404 });
  const base = path.join(Root, map[0]);
  const file = path.normalize(path.join(base, decodeURIComponent(map[1])));
  if (!file.startsWith(base + path.sep)) return new Response("Not found", { status: 404 });
  // pages are written in English; <html lang> tells ui/i18n.js which language to show
  if (file.endsWith(".html")) {
    try {
      const html = fs.readFileSync(file, "utf8").replace('<html lang="en">', `<html lang="${L.lang}">`);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch { return new Response("Not found", { status: 404 }); }
  }
  return net.fetch(pathToFileURL(file).toString());
}

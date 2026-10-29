"use strict";
// The right-click menu on pages: Drift's own menu (ui/popup.html) with what's possible at that spot.
const { clipboard, dialog, session, app } = require("electron");
const path = require("path");
const D = require("./main");
const { showMenu } = require("./popups");

const isWeb = u => !!u && /^https?:\/\//.test(u);
const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
const Names = { google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", brave: "Brave" };

function entriesFor(t, p) {
  const wc = t.wc, list = [], line = () => { if (list.length && !list[list.length - 1].line) list.push({ line: true }); };
  const item = (text, icon, run, extra) => list.push(Object.assign({ text, icon, run }, extra));
  const f = p.editFlags || {};

  // spelling suggestions first, like other browsers
  if (p.isEditable && p.misspelledWord) {
    for (const s of (p.dictionarySuggestions || []).slice(0, 5)) item(s, "spell", () => wc.replaceMisspelling(s), { strong: true });
    if (!(p.dictionarySuggestions || []).length) item("No suggestions", "spell", null, { enabled: false });
    item("Add to dictionary", "check", () => session.defaultSession.addWordToSpellCheckerDictionary(p.misspelledWord));
    line();
  }
  if (isWeb(p.linkURL)) {
    const link = p.linkURL;
    item("Open link in new tab", "tab", () => D.newTab(link, t, false));
    item("Open link in new tab and switch", "open", () => D.newTab(link, t));
    line();
    item("Copy link", "link", () => clipboard.writeText(link));
    item("Save link as…", "save", () => saveAs(t, link));
    line();
  }
  if (p.mediaType === "image" && p.srcURL) {
    const src = p.srcURL;
    if (isWeb(src)) item("Open image in new tab", "image", () => D.newTab(src, t, false));
    item("Copy image", "copy", () => wc.copyImageAt(p.x, p.y));
    if (isWeb(src)) item("Copy image address", "link", () => clipboard.writeText(src));
    item("Save image as…", "save", () => saveAs(t, src));
    line();
  }
  if ((p.mediaType === "video" || p.mediaType === "audio") && p.srcURL) {
    const m = p.mediaFlags || {}, src = p.srcURL, at = `document.elementFromPoint(${p.x}, ${p.y})`;
    const media = js => () => wc.executeJavaScript(`(() => { let el = ${at}; while (el && !(el instanceof HTMLMediaElement)) el = el.parentElement; if (el) { ${js} } })()`, true).catch(() => { });
    item(m.isPaused ? "Play" : "Pause", "play", media("el.paused ? el.play() : el.pause();"));
    item("Loop", "loop", media("el.loop = !el.loop;"), { checked: !!m.isLooping });
    item("Show controls", "all", media("el.controls = !el.controls;"), { checked: !!m.isControlsVisible });
    if (p.mediaType === "video" && m.canPictureInPicture !== false) item("Picture in picture", "pip", media("document.pictureInPictureElement ? document.exitPictureInPicture() : el.requestPictureInPicture();"));
    if (isWeb(src)) item(p.mediaType === "video" ? "Copy video address" : "Copy audio address", "link", () => clipboard.writeText(src));
    if (isWeb(src) && m.canSave !== false) item("Save as…", "save", () => saveAs(t, src));
    line();
  }
  if (p.isEditable) {
    item("Undo", "undo", () => wc.undo(), { enabled: !!f.canUndo, shortcut: mod + "+Z" });
    item("Redo", "redo", () => wc.redo(), { enabled: !!f.canRedo, shortcut: mod + "+Y" });
    line();
    item("Cut", "cut", () => wc.cut(), { enabled: !!f.canCut, shortcut: mod + "+X" });
    item("Copy", "copy", () => wc.copy(), { enabled: !!f.canCopy, shortcut: mod + "+C" });
    item("Paste", "paste", () => wc.paste(), { enabled: !!f.canPaste, shortcut: mod + "+V" });
    item("Paste as plain text", "paste", () => wc.pasteAndMatchStyle(), { enabled: !!f.canPaste, shortcut: mod + "+Shift+V" });
    item("Select all", "all", () => wc.selectAll(), { enabled: f.canSelectAll !== false, shortcut: mod + "+A" });
  } else if (p.selectionText && p.selectionText.trim()) {
    const text = p.selectionText.trim().replace(/\s+/g, " ");
    const shown = text.length > 28 ? text.slice(0, 27).trimEnd() + "…" : text;
    item("Copy", "copy", () => wc.copy(), { shortcut: mod + "+C" });
    item(`Search ${Names[D.store.SearchEngine] || "Google"} for “${shown}”`, "search", () => D.newTab(D.store.searchUrl + encodeURIComponent(text), t));
  }
  // on the page itself: navigation, saving and the page's source
  const plain = !p.linkURL && !p.srcURL && !p.isEditable && !(p.selectionText && p.selectionText.trim());
  if (plain) {
    const h = wc.navigationHistory;
    item("Back", "back", () => h.goBack(), { enabled: h.canGoBack(), shortcut: "Alt+Left" });
    item("Forward", "forward", () => h.goForward(), { enabled: h.canGoForward(), shortcut: "Alt+Right" });
    item("Reload", "reload", () => wc.reload(), { shortcut: mod + "+R" });
    line();
    if (isWeb(p.pageURL)) item("Save page as…", "save", () => savePage(t));
    item("Print…", "print", () => wc.print(), { shortcut: mod + "+P" });
    if (isWeb(p.pageURL)) { line(); item("View page source", "code", () => D.newTab("view-source:" + p.pageURL, t)); }
  }
  if (list.length && list[list.length - 1].line) list.pop();
  return list;
}

// "Save … as": ask where, then download there
async function saveAs(t, url) {
  let name = "download";
  try { name = decodeURIComponent(path.basename(new URL(url).pathname)) || name; } catch { }
  const r = await dialog.showSaveDialog(D.win, { defaultPath: path.join(app.getPath("downloads"), name) });
  if (r.canceled || !r.filePath) return;
  D.saveNextTo = { url, path: r.filePath };
  (t.wc || D.ui).downloadURL(url);
}

async function savePage(t) {
  const wc = t.wc;
  const name = (wc.getTitle() || "page").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) + ".html";
  const r = await dialog.showSaveDialog(D.win, { defaultPath: path.join(app.getPath("downloads"), name), filters: [{ name: "Web page, complete", extensions: ["html", "htm"] }] });
  if (r.canceled || !r.filePath) return;
  try { await wc.savePage(r.filePath, "HTMLComplete"); } catch { }
}

let open = 0;
D.onContextMenu = async (t, p) => {
  const entries = entriesFor(t, p);
  if (!entries.length) return;
  const token = ++open;
  const runs = new Map();
  const shown = entries.map((e, i) => { if (e.line) return { line: true }; runs.set(i, e.run); return { id: i, text: e.text, icon: e.icon, shortcut: e.shortcut, enabled: e.enabled !== false && !!e.run, checked: e.checked, strong: e.strong }; });
  const b = t.view.getBounds(), w = D.win.getContentBounds();
  const point = { x: w.x + b.x + p.x, y: w.y + b.y + p.y };
  const picked = await showMenu(D.win, point, shown);
  if (token !== open) return;
  if (picked != null && runs.get(picked)) try { runs.get(picked)(); } catch (e) { console.error(e); }
  if (D.tabs.includes(t) && t === D.active && !D.overlayOpen && t.wc) t.wc.focus();
};

// Pages ask for a menu through the engine; hook every tab as it's created.
const { app: electronApp } = require("electron");
electronApp.on("web-contents-created", (_, wc) => {
  wc.on("context-menu", (e, params) => {
    const t = D.tabByWc(wc);
    if (t) D.onContextMenu(t, params);
  });
});

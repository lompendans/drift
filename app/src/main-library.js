"use strict";
// Bookmarks (the star in the address bar, Ctrl+D), importing from other browsers, and catching downloads.
const { session } = require("electron");
const { Worker } = require("worker_threads");
const path = require("path");
const D = require("./main");

const isWeb = u => !!u && /^https?:\/\//.test(u);

D.isBookmarked = t => !!t && isWeb(t.url) && D.store.Bookmarks.some(b => b.Url === t.url);

D.toggleBookmark = () => {
  const t = D.active;
  if (!t || !isWeb(t.url)) return;
  const on = !D.isBookmarked(t);
  if (on) D.store.Bookmarks.push({ Url: t.url, Title: t.title && t.title.trim() ? t.title : t.url, Folder: "", Favicon: t.favicon, Added: new Date().toISOString() });
  else D.store.Bookmarks = D.store.Bookmarks.filter(b => b.Url !== t.url);
  D.queueSave();
  D.sendNav();
  D.send({ type: "bookmarked", on });
};

D.sendBookmarks = () => D.send({
  type: "bookmarkList",
  items: D.store.Bookmarks.map(b => ({ url: b.Url, title: b.Title, folder: b.Folder || "", favicon: b.Favicon, added: b.Added })),
});

// ---------------- importing ----------------
// Reading another browser's databases can take a moment, so it runs on a worker thread (import-worker.js).

let sources = null, importing = false;

function work(op, arg) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, "import-worker.js"), { workerData: { op, arg } });
    w.once("message", m => m.error ? reject(new Error(m.error)) : resolve(m.result));
    w.once("error", reject);
  });
}

const sendImportList = () => D.send({
  type: "importSources",
  sources: sources.map(s => ({ id: s.id, browser: s.browser, profile: s.profile, history: s.history, bookmarks: s.bookmarks })),
});

D.sendImportSources = async refresh => {
  try {
    if (!sources || refresh) sources = await work("find");
    sendImportList();
    // counting copies each browser's database, so it fills in as it goes
    for (const s of sources.filter(x => x.history == null)) {
      Object.assign(s, await work("count", s));
      sendImportList();
    }
  } catch (e) { console.error(e); }
};

D.runImport = async (id, history, bookmarks) => {
  const s = sources && sources.find(x => x.id === id);
  if (!s || importing || !(history || bookmarks)) return;
  importing = true;
  D.send({ type: "importStatus", state: "working" });
  try {
    const { pages, marks } = await work("read", { source: s, history, bookmarks });
    const newPages = D.store.mergeHistory(pages);
    const newMarks = D.store.mergeBookmarks(marks);
    D.saveState();
    D.sendNav();
    D.send({ type: "importStatus", state: "done", browser: s.browser + (s.profile ? ` (${s.profile})` : ""), pages: pages.length, newPages, bookmarks: marks.length, newBookmarks: newMarks });
  } catch (e) {
    D.send({ type: "importStatus", state: "error", browser: s.browser, message: e.message });
  } finally { importing = false; }
};

// ---------------- downloads ----------------

session.defaultSession.on("will-download", (_, item, wc) => {
  const t = D.tabByWc(wc);
  // "Save link as…" already asked where
  const ask = D.saveNextTo && D.saveNextTo.url === item.getURL() ? D.saveNextTo.path : null;
  D.saveNextTo = null;
  D.downloads.begin(item, ask);
  if (!t) return;
  t.downloadAt = Date.now();
  // the link's navigation may already have been reported as failed: the page never left, so undo that
  t.loading = false;
  if (t.wc) t.url = t.wc.getURL() || t.url;
  if (t.error) { t.error = null; D.layout(); }
  D.tabChanged(t);
  // a new tab opened just for a download link would stay blank: go back to the tab it came from
  if (!t.committed && D.tabs.length > 1) setTimeout(() => D.closeDownloadTab(t), 0);
});

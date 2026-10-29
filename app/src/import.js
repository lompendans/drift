"use strict";
// Finds Chrome, Edge, Brave, Opera, Vivaldi, Chromium and Firefox profiles on this computer and reads their history
// and bookmarks. The browsers' databases are copied first, so this works while they're open and never changes them.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const HistoryLimit = 3000;   // newest pages per import
const home = os.homedir();
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

// Where each browser keeps its profiles, per platform.
function chromiumRoots() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [
      ["Google Chrome", path.join(local, "Google", "Chrome", "User Data")],
      ["Microsoft Edge", path.join(local, "Microsoft", "Edge", "User Data")],
      ["Brave", path.join(local, "BraveSoftware", "Brave-Browser", "User Data")],
      ["Vivaldi", path.join(local, "Vivaldi", "User Data")],
      ["Chromium", path.join(local, "Chromium", "User Data")],
      ["Opera", path.join(roaming, "Opera Software", "Opera Stable"), true],
      ["Opera GX", path.join(roaming, "Opera Software", "Opera GX Stable"), true],
    ];
  }
  if (process.platform === "darwin") {
    const sup = path.join(home, "Library", "Application Support");
    return [
      ["Google Chrome", path.join(sup, "Google", "Chrome")],
      ["Microsoft Edge", path.join(sup, "Microsoft Edge")],
      ["Brave", path.join(sup, "BraveSoftware", "Brave-Browser")],
      ["Vivaldi", path.join(sup, "Vivaldi")],
      ["Chromium", path.join(sup, "Chromium")],
      ["Opera", path.join(sup, "com.operasoftware.Opera"), true],
    ];
  }
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const flat = id => path.join(home, ".var", "app", id, "config");
  return [
    ["Google Chrome", path.join(cfg, "google-chrome")],
    ["Google Chrome", path.join(flat("com.google.Chrome"), "google-chrome")],
    ["Microsoft Edge", path.join(cfg, "microsoft-edge")],
    ["Brave", path.join(cfg, "BraveSoftware", "Brave-Browser")],
    ["Brave", path.join(flat("com.brave.Browser"), "BraveSoftware", "Brave-Browser")],
    ["Vivaldi", path.join(cfg, "vivaldi")],
    ["Chromium", path.join(cfg, "chromium")],
    ["Chromium", path.join(home, "snap", "chromium", "common", "chromium")],
    ["Chromium", path.join(flat("org.chromium.Chromium"), "chromium")],
    ["Opera", path.join(cfg, "opera"), true],
  ];
}

function firefoxRoots() {
  if (process.platform === "win32") return [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Mozilla", "Firefox")];
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "Firefox")];
  return [path.join(home, ".mozilla", "firefox"), path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"), path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox")];
}

function find() {
  const list = [];
  const seen = new Set();
  for (const [browser, userData, single] of chromiumRoots()) {
    if (!exists(userData) || seen.has(userData)) continue;
    seen.add(userData);
    if (single) {
      if (exists(path.join(userData, "History")) || exists(path.join(userData, "Bookmarks"))) list.push({ browser, kind: "chromium", folder: userData, profile: null });
      continue;
    }
    const names = {};
    try {
      const st = JSON.parse(fs.readFileSync(path.join(userData, "Local State"), "utf8"));
      for (const [k, v] of Object.entries(st.profile?.info_cache || {})) if (v && v.name) names[k] = v.name;
    } catch { }
    let dirs = [];
    try { dirs = fs.readdirSync(userData); } catch { }
    dirs = dirs.filter(n => (n === "Default" || n.startsWith("Profile ")) && (exists(path.join(userData, n, "History")) || exists(path.join(userData, n, "Bookmarks"))))
      .sort((a, b) => (a === "Default" ? "" : a).localeCompare(b === "Default" ? "" : b));
    for (const n of dirs) list.push({ browser, kind: "chromium", folder: path.join(userData, n), profile: dirs.length > 1 ? (names[n] || n) : null });
  }
  for (const root of firefoxRoots()) firefox(root, list);
  list.forEach((s, i) => { s.id = "s" + i; s.history = null; s.bookmarks = null; });
  return list;
}

function firefox(root, list) {
  const ini = path.join(root, "profiles.ini");
  if (!exists(ini)) return;
  const found = [];
  let name = null, p = null, relative = true;
  const flush = () => {
    if (p != null) {
      const dir = relative ? path.join(root, ...p.split("/")) : p;
      if (exists(path.join(dir, "places.sqlite")) && !found.some(f => f.dir === dir)) found.push({ name, dir });
    }
    name = null; p = null; relative = true;
  };
  for (const raw of fs.readFileSync(ini, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) { flush(); continue; }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq), v = line.slice(eq + 1);
    if (k === "Name") name = v; else if (k === "Path") p = v; else if (k === "IsRelative") relative = v === "1";
  }
  flush();
  for (const f of found) list.push({ browser: "Firefox", kind: "firefox", folder: f.dir, profile: found.length > 1 ? f.name : null });
}

// ---------------- reading ----------------

/** Copies a browser's database (and its write-ahead log) to a temp folder, opens the copy, and deletes it after. */
function withCopy(file, use) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drift-import-"));
  try {
    const copy = path.join(tmp, "db.sqlite");
    // read and write rather than copy: the browser may have the file open, and reading allows that
    fs.writeFileSync(copy, fs.readFileSync(file));
    if (exists(file + "-wal")) fs.writeFileSync(copy + "-wal", fs.readFileSync(file + "-wal"));
    const db = new DatabaseSync(copy);
    try { return use(db); } finally { db.close(); }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } }
}

const scalar = (db, sql) => Number(Object.values(db.prepare(sql).get() || { n: 0 })[0]) || 0;
const fromWebKit = micro => { const n = Number(micro); return new Date(n > 0 ? n / 1000 - 11644473600000 : Date.now()).toISOString(); };   // µs since 1601
const fromUnixMicro = micro => { const n = Number(micro); return new Date(n > 0 ? n / 1000 : Date.now()).toISOString(); };              // µs since 1970

function count(s) {
  try {
    if (s.kind === "chromium") {
      s.bookmarks = exists(path.join(s.folder, "Bookmarks")) ? chromiumBookmarks(s, "").length : 0;
      s.history = exists(path.join(s.folder, "History"))
        ? withCopy(path.join(s.folder, "History"), db => scalar(db, "SELECT COUNT(*) FROM urls WHERE hidden = 0 AND url LIKE 'http%'")) : 0;
    } else {
      withCopy(path.join(s.folder, "places.sqlite"), db => {
        s.history = scalar(db, "SELECT COUNT(*) FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL AND url LIKE 'http%'");
        s.bookmarks = scalar(db, "SELECT COUNT(*) FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 AND p.url LIKE 'http%'");
      });
    }
  } catch { if (s.history == null) s.history = -1; if (s.bookmarks == null) s.bookmarks = -1; }
  s.history = Math.min(s.history ?? 0, HistoryLimit);
}

function readHistory(s) {
  const items = [];
  const add = (r, last) => items.push({ Url: r.url, Title: r.title, Favicon: null, Visits: Math.max(1, Number(r.visits) || 1), Last: last });
  if (s.kind === "chromium") {
    const file = path.join(s.folder, "History");
    if (!exists(file)) return items;
    withCopy(file, db => {
      for (const r of db.prepare(`SELECT url, title, visit_count AS visits, last_visit_time AS t FROM urls WHERE hidden = 0 AND url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ${HistoryLimit}`).all())
        add(r, fromWebKit(r.t));
    });
  } else {
    withCopy(path.join(s.folder, "places.sqlite"), db => {
      for (const r of db.prepare(`SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL AND url LIKE 'http%' ORDER BY last_visit_date DESC LIMIT ${HistoryLimit}`).all())
        add(r, fromUnixMicro(r.t));
    });
  }
  return items;
}

function readBookmarks(s) {
  const top = "From " + s.browser + (s.profile ? ` (${s.profile})` : "");
  if (s.kind === "chromium") return chromiumBookmarks(s, top);
  const list = [];
  withCopy(path.join(s.folder, "places.sqlite"), db => {
    const rows = db.prepare("SELECT b.id, b.parent, b.type, b.title, b.guid, p.url, b.dateAdded AS added FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk").all();
    const byId = new Map(rows.map(r => [Number(r.id), r]));
    const folderName = f => ({ "root________": null, "toolbar_____": "Bookmarks toolbar", "menu________": "Bookmarks menu", "unfiled_____": "Other bookmarks", "mobile______": "Mobile bookmarks" })[f.guid] ?? f.title;
    const pathOf = parent => {
      const parts = [];
      for (let id = Number(parent), f; (f = byId.get(id)) && parts.length < 20; id = Number(f.parent)) {
        const n = folderName(f);
        if (n) parts.unshift(n);
        if (Number(f.parent) === id) break;
      }
      return [top, ...parts].join(" / ");
    };
    for (const b of rows)
      if (Number(b.type) === 1 && b.url && b.url.startsWith("http"))
        list.push({ Url: b.url, Title: b.title && b.title.trim() ? b.title : b.url, Folder: pathOf(b.parent), Favicon: null, Added: fromUnixMicro(b.added) });
  });
  return list;
}

function chromiumBookmarks(s, top) {
  const list = [];
  const file = path.join(s.folder, "Bookmarks");
  if (!exists(file)) return list;
  const roots = JSON.parse(fs.readFileSync(file, "utf8")).roots || {};
  const walk = (node, p) => {
    if (!node || !node.type) return;
    if (node.type === "url") {
      if (!node.url || !node.url.startsWith("http")) return;
      list.push({ Url: node.url, Title: node.name && node.name.trim() ? node.name : node.url, Folder: p, Favicon: null, Added: fromWebKit(node.date_added || 0) });
    } else for (const k of node.children || []) walk(k, k.type === "folder" ? p + " / " + (k.name || "Folder") : p);
  };
  for (const [key, label] of [["bookmark_bar", "Bookmarks bar"], ["other", "Other bookmarks"], ["synced", "Mobile bookmarks"]])
    if (roots[key]) walk(roots[key], top ? top + " / " + label : label);
  return list;
}

module.exports = { find, count, readHistory, readBookmarks };

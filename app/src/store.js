"use strict";
// Everything Drift remembers, saved to state.json in the data folder (%AppData%\Drift, ~/.config/Drift).
// The file keeps Drift 1.x's layout and names, so tabs, history, bookmarks and settings carry over.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const Engines = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  brave: "https://search.brave.com/search?q=",
};

const HistoryLimit = 5000;

const defaults = () => ({
  SearchEngine: "google",
  Theme: "system",
  HomePage: "",
  AdblockEnabled: true,
  AdblockAllowed: [],
  AdsBlockedTotal: 0,
  FilterLists: null,
  SidebarCollapsed: false,
  Session: [],
  ActiveIndex: 0,
  Bounds: null,
  Maximized: false,
  History: [],
  Downloads: [],
  Bookmarks: [],
  Extensions: [],
  ExternalAllowed: [],
  Permissions: [],          // [{ Origin, Kind, State }]: allow / block answers the user chose to keep
  Language: "system",       // system, en, tr
  Accent: "teal",
  Density: "comfortable",
  Corners: "rounded",       // rounded, square   // comfortable, compact: height of the tab list's rows
  ShowHomeButton: true,
  StartupMode: "restore",   // restore: reopen last time's tabs; home: start with the home page
  StartClock: true,
  StartShortcuts: true,
  StartBackground: "glow",  // glow, plain
  Shortcuts: null,          // [{ Name, Url }] once the user edits the start page's shortcuts; null shows the most visited sites
});

const folder = () => app.getPath("userData");
const file = () => path.join(folder(), "state.json");

function score(h) {
  return (h.Visits || 0) / (1 + (Date.now() - new Date(h.Last).getTime()) / 864e5 / 7);
}

class Store {
  constructor(data) { Object.assign(this, defaults(), data); }

  static load() {
    try {
      const text = fs.readFileSync(file(), "utf8").replace(/^﻿/, "");
      return new Store(JSON.parse(text));
    } catch { return new Store({}); }
  }

  static get folder() { return folder(); }

  save() {
    try {
      fs.mkdirSync(folder(), { recursive: true });
      const tmp = file() + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this));
      fs.renameSync(tmp, file());
    } catch { }
  }

  get searchUrl() { return Engines[this.SearchEngine] || Engines.google; }

  addHistory(url, title, favicon) {
    if (!url || !/^https?:\/\//.test(url)) return;
    let h = this.History.find(x => x.Url === url);
    if (!h) { h = { Url: url, Title: null, Favicon: null, Visits: 0, Last: null }; this.History.push(h); }
    h.Visits++;
    h.Last = new Date().toISOString();
    if (title && title.trim()) h.Title = title;
    if (favicon) h.Favicon = favicon;
    this.trimHistory();
  }

  trimHistory() {
    if (this.History.length > HistoryLimit)
      this.History = this.History.map(h => [score(h), h]).sort((a, b) => b[0] - a[0]).slice(0, HistoryLimit - 500).map(x => x[1]);
  }

  /** Adds pages from another browser; pages Drift already knows keep their newest visit. Returns how many were new. */
  mergeHistory(items) {
    const byUrl = new Map(this.History.map(h => [h.Url, h]));
    let added = 0;
    for (const it of items) {
      if (!it.Url) continue;
      const h = byUrl.get(it.Url);
      if (h) {
        h.Visits += it.Visits;
        if (new Date(it.Last) > new Date(h.Last)) h.Last = it.Last;
        if (!h.Title) h.Title = it.Title;
      } else { this.History.push(it); byUrl.set(it.Url, it); added++; }
    }
    this.trimHistory();
    return added;
  }

  mergeBookmarks(items) {
    const have = new Set(this.Bookmarks.map(b => (b.Folder || "") + "\n" + b.Url));
    let added = 0;
    for (const b of items) {
      const key = (b.Folder || "") + "\n" + b.Url;
      if (b.Url && !have.has(key)) { have.add(key); this.Bookmarks.push(b); added++; }
    }
    return added;
  }

  suggestions() {
    return [...this.History].sort((a, b) => new Date(b.Last) - new Date(a.Last)).slice(0, 600)
      .map(h => ({ url: h.Url, title: h.Title, favicon: h.Favicon, score: Math.round(score(h) * 1000) / 1000 }));
  }

  /** The start page's shortcuts: the user's own list, or the most visited sites. */
  shortcuts() {
    if (!Array.isArray(this.Shortcuts)) return this.topSites(8);
    return this.Shortcuts.map(s => {
      let host = ""; try { host = new URL(s.Url).host; } catch { }
      const seen = host && this.History.find(h => h.Favicon && h.Url.includes("//" + host + "/"));
      return { url: s.Url, name: s.Name || host.replace(/^www\./, ""), favicon: seen ? seen.Favicon : null };
    });
  }

  topSites(n) {
    const groups = new Map();
    for (const h of this.History) {
      let u; try { u = new URL(h.Url); } catch { continue; }
      const g = groups.get(u.host) || { host: u.host, score: 0, best: h };
      g.score += score(h);
      if ((h.Visits || 0) > (g.best.Visits || 0)) g.best = h;
      groups.set(u.host, g);
    }
    return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, n).map(g => ({
      url: new URL(g.best.Url).origin + "/",
      name: g.host.startsWith("www.") ? g.host.slice(4) : g.host,
      favicon: g.best.Favicon,
    }));
  }
}

module.exports = { Store, Engines };

"use strict";
// Keeps the uBlock Origin / EasyList filter lists: downloads them, caches them in the data folder's "filters"
// folder (shared with Drift 1.x), refreshes them every few days, and rebuilds the filter engine.
const fs = require("fs");
const path = require("path");
const { net } = require("electron");
const { FilterEngine } = require("./filters");
const { Store } = require("./store");

const Lists = [
  ["ublock-ads", "uBlock filters – Ads", "Ads", "https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt", true],
  ["easylist", "EasyList", "Ads", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist.txt", true],
  ["peter-lowe", "Peter Lowe's ad and tracking server list", "Ads", "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext", true],
  ["ublock-privacy", "uBlock filters – Privacy", "Privacy", "https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt", true],
  ["easyprivacy", "EasyPrivacy", "Privacy", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easyprivacy.txt", true],
  ["ublock-annoyances", "uBlock filters – Annoyances", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/filters/annoyances.txt", true],
  ["easylist-annoyances", "EasyList – Annoyances", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-annoyances.txt", true],
  ["easylist-cookies", "EasyList – Cookie notices", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-cookies.txt", true],
  ["easylist-newsletters", "EasyList – Newsletter notices", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-newsletters.txt", true],
  ["easylist-notifications", "EasyList – Notification prompts", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-notifications.txt", true],
  ["easylist-social", "EasyList – Social widgets", "Annoyances", "https://ublockorigin.github.io/uAssetsCDN/thirdparties/easylist-social.txt", true],
  ["ublock-badware", "uBlock filters – Badware risks", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt", true],
  ["ublock-quick-fixes", "uBlock filters – Quick fixes", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt", true],
  ["ublock-unbreak", "uBlock filters – Unbreak", "Security", "https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt", true],
  ["url-tracking", "AdGuard/uBO – URL tracking protection", "Optional", "https://ublockorigin.github.io/uAssetsCDN/filters/privacy-removeparam.txt", false],
  ["lan-block", "uBlock filters – Block outsider intrusion into LAN", "Optional", "https://ublockorigin.github.io/uAssetsCDN/filters/lan-block.txt", false],
].map(([id, name, group, url, defaultOn]) => ({ id, name, group, url, defaultOn }));

// Used until the downloaded lists are available (first run, or offline).
const Builtin = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "adservice.google.com",
  "2mdn.net", "google-analytics.com", "scorecardresearch.com", "quantserve.com", "hotjar.com", "clarity.ms", "bat.bing.com",
  "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "criteo.com", "criteo.net", "rubiconproject.com", "pubmatic.com",
  "openx.net", "casalemedia.com", "3lift.com", "teads.tv", "smartadserver.com", "adform.net", "media.net", "moatads.com",
  "adsafeprotected.com", "doubleverify.com", "taboola.com", "outbrain.com", "revcontent.com", "mgid.com", "popads.net",
  "propellerads.com", "exoclick.com", "demdex.net", "bluekai.com", "krxd.net", "chartbeat.com"];

const RefreshDays = 4;
const dir = () => path.join(Store.folder, "filters");
const pathFor = id => path.join(dir(), id + ".txt");

async function download(url) {
  const res = await net.fetch(url, { headers: { "User-Agent": "Drift/2" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

// Some lists are split into parts with "!#include other-file.txt" (relative to the list's own address).
async function downloadWithIncludes(url, depth) {
  const text = await download(url);
  if (depth >= 3 || !text.includes("!#include ")) return text;
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("!#include ")) {
      const part = t.slice(10).trim();
      if (part.includes("..") || part.includes("://")) continue;   // same folder only
      try { out.push(await downloadWithIncludes(new URL(part, url).toString(), depth + 1)); } catch { }
    } else out.push(line);
  }
  return out.join("\n");
}

class AdBlocker {
  constructor() {
    this.engine = FilterEngine.build([], null, Builtin);
    this.status = Object.fromEntries(Lists.map(l => [l.id, { rules: 0, updated: null, state: "missing" }]));
    for (const l of Lists) {
      try { const st = fs.statSync(pathFor(l.id)); this.status[l.id].state = "ok"; this.status[l.id].updated = st.mtime; } catch { }
    }
    this.busy = false;
    this.onChanged = () => { };
    this.refreshing = false; this.again = null;
  }

  /** Loads cached lists right away, then downloads any that are missing or stale (all of them when forced). */
  async refresh(enabled, force) {
    if (this.refreshing) { this.again = { enabled, force: force || (this.again && this.again.force) }; return; }
    this.refreshing = true;
    try {
      this.busy = true;
      this.onChanged();
      await this.rebuild(enabled);   // cached lists first, so blocking starts immediately
      let downloaded = false;
      for (const l of Lists.filter(x => enabled.has(x.id))) {
        const st = this.status[l.id];
        if (!force && st.updated && (Date.now() - st.updated) / 864e5 < RefreshDays) continue;
        st.state = "downloading";
        this.onChanged();
        try {
          const text = await downloadWithIncludes(l.url, 0);
          if (text.length < 200) throw new Error("List looks empty");
          fs.mkdirSync(dir(), { recursive: true });
          fs.writeFileSync(pathFor(l.id), text);
          st.state = "ok";
          st.updated = new Date();
          downloaded = true;
        } catch {
          st.state = fs.existsSync(pathFor(l.id)) ? "error-cached" : "error";
        }
        this.onChanged();
      }
      if (downloaded) await this.rebuild(enabled);
    } finally {
      this.busy = false;
      this.refreshing = false;
      this.onChanged();
      const again = this.again;
      this.again = null;
      if (again) this.refresh(again.enabled, again.force);
    }
  }

  async rebuild(enabled) {
    const lists = [];
    for (const l of Lists) {
      if (!enabled.has(l.id)) continue;
      try { lists.push([l.id, await fs.promises.readFile(pathFor(l.id), "utf8")]); } catch { }
    }
    await new Promise(r => setImmediate(r));
    const counts = {};
    this.engine = FilterEngine.build(lists, counts, Builtin);
    for (const l of Lists) this.status[l.id].rules = counts[l.id] || 0;
    this.onChanged();
  }
}

module.exports = { AdBlocker, Lists };

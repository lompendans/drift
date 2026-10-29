"use strict";
// Chrome extensions in Drift: installing from the Chrome Web Store and Edge Add-ons (or a folder), and reading what an
// extension's manifest says. The engine runs them; Drift adds the toolbar buttons, pop-ups and options pages.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { net } = require("electron");
const { Store } = require("./store");

const folder = () => path.join(Store.folder, "extensions");
const StoreHosts = ["chromewebstore.google.com", "chrome.google.com", "microsoftedge.microsoft.com"];
const StoreLink = /^https:\/\/(chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?|chrome\.google\.com\/webstore\/detail\/(?:[^/]+\/)?|microsoftedge\.microsoft\.com\/addons\/detail\/(?:[^/]+\/)?)([a-p]{32})/i;

/** Recognizes an extension's store page (or a bare 32-letter id). Returns { id, source } or null. */
function parseStoreLink(text) {
  text = (text || "").trim();
  const m = StoreLink.exec(text);
  if (m) return { id: m[2].toLowerCase(), source: m[1].toLowerCase().startsWith("microsoftedge") ? "edge" : "chrome" };
  if (/^[a-p]{32}$/.test(text)) return { id: text, source: "chrome" };
  return null;
}

// A .crx is a short header followed by an ordinary zip file.
function zipOffset(crx) {
  if (crx.length > 16 && crx.toString("latin1", 0, 4) === "Cr24") {
    const version = crx.readInt32LE(4);
    if (version === 3) return 12 + crx.readInt32LE(8);
    if (version === 2) return 16 + crx.readInt32LE(8) + crx.readInt32LE(12);
  }
  if (crx.length > 4 && crx[0] === 0x50 && crx[1] === 0x4b) return 0;
  throw new Error("The store didn't send an extension. It may not be available.");
}

// A small zip reader: enough for extension packages (stored and deflated entries).
function unzip(buf, target) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("The extension package is damaged.");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(target) + path.sep;
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The extension package is damaged.");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const out = path.resolve(target, name);
    if (!out.startsWith(root)) continue;   // stay inside the folder
    if (name.endsWith("/")) { fs.mkdirSync(out, { recursive: true }); continue; }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(data) : data);
  }
}

/** Downloads an extension package and unpacks it into Drift's extensions folder. Returns the folder. */
async function download(id, source) {
  const major = process.versions.chrome.split(".")[0];
  const url = source === "edge"
    ? `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D${id}%26installsource%3Dondemand%26uc`
    : `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${major}.0&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
  const res = await net.fetch(url, { headers: { "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36` } });
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { network: true });
  const crx = Buffer.from(await res.arrayBuffer());
  const zip = crx.subarray(zipOffset(crx));
  const target = path.join(folder(), id), staging = target + ".new";
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  unzip(zip, staging);
  // Chrome adds this folder to signed packages; it's not part of the extension
  fs.rmSync(path.join(staging, "_metadata"), { recursive: true, force: true });
  if (!fs.existsSync(path.join(staging, "manifest.json"))) throw new Error("That download isn't an extension.");
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  return target;
}

// ---------------- manifest ----------------

const parseJson = text => JSON.parse(text.replace(/^\uFEFF/, "").replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s || "").replace(/,(\s*[}\]])/g, "$1"));

function messages(dir, locale) {
  for (const loc of [locale, "en", "en_US"].filter((x, i, a) => x && a.indexOf(x) === i)) {
    const file = path.join(dir, "_locales", loc, "messages.json");
    if (!fs.existsSync(file)) continue;
    try {
      const out = {};
      for (const [k, v] of Object.entries(parseJson(fs.readFileSync(file, "utf8")))) if (v && typeof v.message === "string") out[k.toLowerCase()] = v.message;
      return out;
    } catch { }
    break;
  }
  return {};
}

function iconData(dir, file) {
  if (!file) return null;
  const p = path.resolve(dir, file.replace(/^\/+/, ""));
  if (!p.startsWith(path.resolve(dir)) || !fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  const type = ext === ".svg" ? "image/svg+xml" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return `data:${type};base64,${fs.readFileSync(p).toString("base64")}`;
}

function readManifest(dir) {
  const m = { name: null, version: null, description: null, icon: null, popup: null, options: null, permissions: [] };
  if (!dir || !fs.existsSync(path.join(dir, "manifest.json"))) return m;
  const root = parseJson(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const str = v => typeof v === "string" ? v : null;
  const msgs = messages(dir, str(root.default_locale));
  const loc = s => s && s.startsWith("__MSG_") && s.endsWith("__") ? (msgs[s.slice(6, -2).toLowerCase()] ?? s) : s;
  m.name = loc(str(root.name)) || "Extension";
  m.version = str(root.version);
  m.description = loc(str(root.description));
  for (const key of ["action", "browser_action", "page_action"]) if (root[key] && !m.popup) m.popup = str(root[key].default_popup);
  m.options = str(root.options_ui?.page) || str(root.options_page);
  // the largest icon up to 128px, as a data URL so the UI can show it
  if (root.icons && typeof root.icons === "object") {
    const best = Object.entries(root.icons).map(([k, f]) => ({ size: parseInt(k) || 0, file: str(f) })).filter(x => x.file)
      .sort((a, b) => (a.size > 128 ? 1000 - a.size : -a.size) - (b.size > 128 ? 1000 - b.size : -b.size))[0];
    if (best) m.icon = iconData(dir, best.file);
  }
  if (!m.icon) for (const key of ["action", "browser_action"]) {
    const di = root[key]?.default_icon;
    if (!m.icon && di) m.icon = iconData(dir, typeof di === "string" ? di : Object.values(di).pop());
  }
  m.permissions = describe(root);
  return m;
}

// What the extension asks for, in words someone can decide on.
function describe(root) {
  const perms = new Set(), hosts = new Set();
  for (const key of ["permissions", "host_permissions", "optional_host_permissions"])
    for (const p of Array.isArray(root[key]) ? root[key] : []) if (typeof p === "string") (p.includes("://") || p === "<all_urls>" ? hosts : perms).add(p);
  for (const c of Array.isArray(root.content_scripts) ? root.content_scripts : []) for (const mm of c.matches || []) hosts.add(mm);
  const lines = [];
  const all = [...hosts].some(h => h === "<all_urls>" || /^(\*|https?):\/\/\*\//.test(h));
  if (all) lines.push("Read and change everything on all websites");
  else if (hosts.size) {
    const names = [...new Set([...hosts].map(h => (/:\/\/(?:\*\.)?([^/]+)/.exec(h) || [])[1]).filter(Boolean))];
    lines.push("Read and change your data on " + (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more sites`));
  }
  const words = [["history", "Read and change your browsing history"], ["tabs", "See the addresses of your open tabs"],
    ["bookmarks", "Read and change your bookmarks"], ["downloads", "Manage your downloads"], ["cookies", "Read and change cookies"],
    ["clipboardRead", "Read what you copy"], ["clipboardWrite", "Change what's on your clipboard"], ["declarativeNetRequest", "Block content on pages"],
    ["webRequestBlocking", "Block and change page requests"], ["notifications", "Show notifications"], ["nativeMessaging", "Talk to programs on your computer"],
    ["management", "Manage your other extensions"], ["proxy", "Change your proxy settings"], ["privacy", "Change privacy settings"],
    ["geolocation", "Know your location"], ["desktopCapture", "Capture your screen"], ["debugger", "Control pages with the debugger"]];
  for (const [p, t] of words) if (perms.has(p)) lines.push(t);
  return lines;
}

module.exports = { folder, StoreHosts, parseStoreLink, download, readManifest };

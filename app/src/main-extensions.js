"use strict";
// Extensions: installing, the toolbar (puzzle button and pinned icons), pop-ups and options pages.
// Drift keeps a record of each one in state.json (Drift 1.x's records carry over) and loads them at startup.
const fs = require("fs");
const path = require("path");
const { session, dialog } = require("electron");
const D = require("./main");
const X = require("./extensions");
const { ExtensionPopup } = require("./popups");

const ses = () => session.defaultSession;
const api = () => ses().extensions || ses();   // newer Electron keeps these on session.extensions
let busy = false, popup = null;

const status = (state, message) => D.send({ type: "extStatus", state, message });

/** Loads every extension the user added, as Drift starts. */
async function install() {
  for (const rec of D.store.Extensions) {
    if (rec.Disabled || !rec.Folder || !fs.existsSync(path.join(rec.Folder, "manifest.json"))) continue;
    try { rec.Id = (await api().loadExtension(rec.Folder, { allowFileAccess: true })).id; } catch (e) { rec.Error = e.message; }
  }
  // records whose files are gone can't come back
  D.store.Extensions = D.store.Extensions.filter(r => r.Folder && fs.existsSync(r.Folder));
  D.queueSave();
  D.sendExtensions();
}

function storeInfo(url) {
  const s = X.parseStoreLink(url);
  if (!s || !(url || "").startsWith("https://")) return null;
  return { id: s.id, source: s.source, installed: D.store.Extensions.some(r => r.StoreId === s.id) };
}

D.sendExtensions = () => {
  const loaded = new Map(api().getAllExtensions().map(e => [e.id, e]));
  const items = D.store.Extensions.map(rec => {
    let m;
    try { m = X.readManifest(rec.Folder); } catch { m = {}; }
    return {
      id: rec.Id, name: m.name || (loaded.get(rec.Id) || {}).name || "Extension", version: m.version, description: m.description, icon: m.icon,
      enabled: !rec.Disabled && loaded.has(rec.Id), pinned: !!rec.Pinned, popup: !!m.popup, options: !!m.options, source: rec.Source,
    };
  }).filter(x => x.id);
  D.send({ type: "extensions", items, busy });
};

D.installFromStore = async text => {
  const s = X.parseStoreLink(text);
  if (!s) { status("error", "Paste a link to an extension on the Chrome Web Store or Edge Add-ons."); return; }
  if (busy) return;
  busy = true;
  status("downloading");
  let folder;
  try { folder = await X.download(s.id, s.source); }
  catch (e) {
    busy = false;
    status("error", e.network || /net::|fetch/i.test(e.message) ? "Couldn't download it. Check your connection, or the extension may not be available." : e.message);
    return;
  }
  confirm(folder, { StoreId: s.id, Source: s.source, Folder: folder }, true);
};

D.loadUnpacked = async () => {
  const r = await dialog.showOpenDialog(D.win, { title: "Choose the folder that contains the extension's manifest.json", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = r.filePaths[0];
  if (!fs.existsSync(path.join(dir, "manifest.json"))) { status("error", "That folder has no manifest.json, so it isn't an extension."); return; }
  if (busy) return;
  busy = true;
  confirm(dir, { Source: "folder", Folder: dir }, false);
};

// Shows what the extension can do and installs it only if the user agrees.
function confirm(folder, rec, deleteIfCancelled) {
  let m;
  try { m = X.readManifest(folder); } catch { busy = false; status("error", "Its manifest.json couldn't be read."); return; }
  status("confirm");
  D.queueDialog({
    kind: "extension", app: m.name, text: m.icon,
    message: m.permissions.length ? m.permissions.join("\n") : "It doesn't ask for any special permissions.",
    origin: rec.Source === "folder" ? "" : rec.Source === "edge" ? "https://microsoftedge.microsoft.com" : "https://chromewebstore.google.com",
    answer: ok => finish(ok, folder, rec, m, deleteIfCancelled),
  });
}

async function finish(ok, folder, rec, m, deleteIfCancelled) {
  try {
    if (!ok) {
      if (deleteIfCancelled) fs.rmSync(folder, { recursive: true, force: true });
      status("idle");
      return;
    }
    // installing a newer copy of an extension that's already here replaces it
    const same = r => (rec.StoreId && r.StoreId === rec.StoreId) || (r.Folder && path.resolve(r.Folder).toLowerCase() === path.resolve(folder).toLowerCase());
    for (const r of D.store.Extensions.filter(same)) if (r.Id) try { api().removeExtension(r.Id); } catch { }
    D.store.Extensions = D.store.Extensions.filter(r => !same(r));
    const ext = await api().loadExtension(folder, { allowFileAccess: true });
    rec.Id = ext.id;
    rec.Pinned = !!m.popup && !D.store.Extensions.some(r => r.Pinned);   // the first one with a pop-up gets a toolbar button
    D.store.Extensions = D.store.Extensions.filter(r => r.Id !== ext.id);
    D.store.Extensions.push(rec);
    D.queueSave();
    status("done", m.name);
    D.sendNav();
  } catch (e) {
    if (deleteIfCancelled) fs.rmSync(folder, { recursive: true, force: true });
    status("error", "Drift couldn't add it: " + e.message);
  } finally {
    busy = false;
    D.sendExtensions();
  }
}

const record = id => D.store.Extensions.find(r => r.Id === id);

D.setExtensionEnabled = async (id, on) => {
  const rec = record(id);
  if (!rec) return;
  try {
    if (on) { rec.Disabled = false; rec.Id = (await api().loadExtension(rec.Folder, { allowFileAccess: true })).id; }
    else { rec.Disabled = true; api().removeExtension(id); }
  } catch { }
  D.queueSave();
  D.sendExtensions();
};

D.removeExtension = id => {
  try { api().removeExtension(id); } catch { }
  const rec = record(id);
  if (rec) {
    D.store.Extensions = D.store.Extensions.filter(r => r !== rec);
    // only delete files Drift downloaded, never a developer's own folder
    if (rec.Source !== "folder" && rec.Folder && path.resolve(rec.Folder).startsWith(path.resolve(X.folder()) + path.sep))
      try { fs.rmSync(rec.Folder, { recursive: true, force: true }); } catch { }
    D.queueSave();
  }
  D.sendNav();
  D.sendExtensions();
};

D.pinExtension = (id, on) => {
  const rec = record(id);
  if (rec) { rec.Pinned = on; D.queueSave(); }
  D.sendExtensions();
};

D.openExtensionPopup = (id, x, y, w, h) => {
  const rec = record(id);
  let m = {};
  try { m = X.readManifest(rec && rec.Folder); } catch { }
  if (!m.popup) { if (m.options) D.openExtensionOptions(id); return; }
  if (popup) popup.close();
  const b = D.win.getContentBounds();
  const anchor = { x: b.x + x + w, y: b.y + y + h + 6 };
  popup = new ExtensionPopup(D.win, anchor, `chrome-extension://${id}/${m.popup.replace(/^\/+/, "")}`, ses(), url => D.newTab(url, D.active));
  const mine = popup;
  popup.w.on("closed", () => { if (popup === mine) popup = null; if (!D.overlayOpen && D.active && D.active.wc) D.active.wc.focus(); });
};

D.openExtensionOptions = id => {
  const rec = record(id);
  let m = {};
  try { m = X.readManifest(rec && rec.Folder); } catch { }
  if (m.options) D.newTab(`chrome-extension://${id}/${m.options.replace(/^\/+/, "")}`, D.active);
};

module.exports = { install, storeInfo };

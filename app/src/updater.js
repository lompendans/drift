"use strict";
// Keeps Drift up to date from its GitHub releases: checks for a newer version, downloads it in the background,
// checks the file's SHA-256 against the one GitHub publishes, and puts it in place when Drift restarts or closes.
//  - Windows: DriftSetup.exe, run in update mode (it waits for Drift to close, then replaces the files).
//  - Linux AppImage: the new AppImage replaces the old file.
//  - Other Linux installs (.deb, .tar.gz) can't replace themselves, so Drift says where to get the new version.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { app, net } = require("electron");

const Repo = "lompendans/drift";
const DownloadPage = "https://lompendans.github.io/drift/";

const parse = v => { const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(v || ""); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
const arch = process.arch === "arm64" ? "arm64" : "x86_64";

class Updater {
  constructor() {
    this.state = "idle"; this.latest = null; this.error = null; this.percent = 0; this.file = null; this.busy = false;
    this.onChanged = () => { };
  }

  get current() { return app.getVersion(); }
  get folder() { return path.join(app.getPath("userData"), "updates"); }

  /** How this copy of Drift updates: "setup" (Windows), "appimage", or "manual". */
  get kind() {
    if (process.platform === "win32") return "setup";
    if (process.platform === "linux" && process.env.APPIMAGE) return "appimage";
    return "manual";
  }

  assetName() {
    return this.kind === "setup" ? /^DriftSetup.*\.exe$/i : new RegExp(`^Drift-${arch}\\.AppImage$`, "i");
  }

  set(state) { this.state = state; if (state !== "error") this.error = null; this.onChanged(); }

  async check() {
    if (this.busy || this.state === "ready" || !app.isPackaged) return;
    this.busy = true;
    try {
      this.set("checking");
      const res = await net.fetch(`https://api.github.com/repos/${Repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Drift/" + this.current } });
      if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { network: true });
      const rel = await res.json();
      const latest = parse(rel.tag_name);
      if (!latest) throw new Error("Unreadable version " + rel.tag_name);
      this.latest = latest.join(".");
      if (!newer(latest, parse(this.current))) { this.set("latest"); return; }
      if (this.kind === "manual") { this.set("manual"); return; }

      // the right file for this computer, and the SHA-256 GitHub computed for it
      const asset = (rel.assets || []).find(a => this.assetName().test(a.name || ""));
      if (!asset) throw new Error("The release has no file for this computer");
      if (!/^sha256:/.test(asset.digest || "")) throw new Error("The release has no checksum");
      const expected = asset.digest.slice(7).toLowerCase();

      fs.mkdirSync(this.folder, { recursive: true });
      for (const old of fs.readdirSync(this.folder)) try { fs.rmSync(path.join(this.folder, old), { force: true }); } catch { }
      const target = path.join(this.folder, this.kind === "setup" ? `DriftSetup-${this.latest}.exe` : `Drift-${this.latest}.AppImage`);
      const part = target + ".part";
      this.percent = 0;
      this.set("downloading");
      const dl = await net.fetch(asset.browser_download_url, { headers: { "User-Agent": "Drift/" + this.current } });
      if (!dl.ok) throw Object.assign(new Error("HTTP " + dl.status), { network: true });
      const total = Number(dl.headers.get("content-length")) || asset.size || 0;
      const hash = crypto.createHash("sha256");
      const out = fs.createWriteStream(part);
      let got = 0;
      for await (const chunk of dl.body) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise(r => out.once("drain", r));
        got += chunk.length;
        const pct = total ? Math.floor(got * 100 / total) : 0;
        if (pct !== this.percent) { this.percent = pct; this.onChanged(); }
      }
      await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
      if (hash.digest("hex") !== expected) { fs.rmSync(part, { force: true }); throw new Error("The download didn't match its checksum"); }
      fs.renameSync(part, target);
      if (this.kind === "appimage") fs.chmodSync(target, 0o755);
      this.file = target;
      this.set("ready");
    } catch (e) {
      this.error = e.network || /fetch|net::/i.test(e.message) ? "Couldn't reach GitHub" : e.message;
      this.set("error");
    } finally { this.busy = false; }
  }

  /** Puts the downloaded version in place as Drift exits, and opens it again when relaunch is set. */
  apply(relaunch) {
    if (this.state !== "ready" || !this.file || !fs.existsSync(this.file)) return false;
    try {
      if (this.kind === "setup") {
        const dir = path.dirname(process.execPath);
        const args = ["/update", `/dir=${dir}`, `/wait=${process.pid}`];
        if (relaunch) args.push("/relaunch");
        spawn(this.file, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: false }).unref();
      } else {
        const current = process.env.APPIMAGE;
        // a rename over the running file is safe on Linux: the old one stays readable until Drift exits
        try { fs.renameSync(this.file, current); }
        catch { fs.copyFileSync(this.file, current + ".new"); fs.chmodSync(current + ".new", 0o755); fs.renameSync(current + ".new", current); }
        if (relaunch) spawn(current, [], { detached: true, stdio: "ignore" }).unref();
      }
      this.state = "applying";
      this.onChanged();
      return true;
    } catch { return false; }
  }

  dto() { return { type: "update", state: this.state, current: this.current, latest: this.latest, percent: this.percent, error: this.error }; }
}

module.exports = { Updater, DownloadPage };

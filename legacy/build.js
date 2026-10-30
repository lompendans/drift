"use strict";
// Builds Drift Legacy: Drift (../app) on an older Electron, for computers new Drift can't run on.
//   Windows 7, 8, 8.1 and 32-bit Windows: Electron 22 (Chromium 108, the last for Windows 7)
//   32-bit Linux:                         Electron 18 (Chromium 100, the last for 32-bit Linux)
// Neither Chromium gets security fixes any more, so Drift Legacy says so on every screen.
//
//   node build.js stage                 copy Drift's files into ./stage and adapt them (run it with ./node_modules/.bin/electron stage)
//   node build.js package win32 ia32    stage, then package into ./out (also: win32 x64, linux ia32)
const fs = require("fs");
const path = require("path");

const here = __dirname;
const app = path.join(here, "..", "app");
const stage = path.join(here, "stage");
const Engines = { win32: "22.3.27", linux: "18.3.15" };

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

/** Replaces each `from` in a staged file: it must appear exactly once, or at least once when the pair ends with "all". */
function patch(file, pairs) {
  const f = path.join(stage, file);
  let s = fs.readFileSync(f, "utf8");
  for (const [from, to, all] of pairs) {
    const n = s.split(from).length - 1;
    if (all ? n < 1 : n !== 1) throw new Error(`${file}: expected ${all ? "some" : "1"} "${from.slice(0, 60)}", found ${n}. Did Drift change? Update legacy/build.js.`);
    s = all ? s.split(from).join(to) : s.replace(from, () => to);
  }
  fs.writeFileSync(f, s);
}

function stageFiles() {
  fs.rmSync(stage, { recursive: true, force: true });
  for (const d of ["src", "ui", "pages", "test"]) copyDir(path.join(app, d), path.join(stage, d));
  fs.mkdirSync(path.join(stage, "build"), { recursive: true });
  for (const f of ["icon.ico", "icon.png"]) fs.copyFileSync(path.join(app, "build", f), path.join(stage, "build", f));
  for (const f of ["legacy.js", "legacy-sqlite.js"]) fs.copyFileSync(path.join(here, f), path.join(stage, "src", f));
  fs.copyFileSync(path.join(here, "node_modules", "sql.js", "dist", "sql-asm.js"), path.join(stage, "src", "sql-asm.js"));

  const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
    name: "drift-legacy", productName: "Drift Legacy", version: pkg.version, description: "Drift for older computers (an old engine without security fixes)",
    homepage: pkg.homepage, main: "src/legacy.js", author: pkg.author, license: pkg.license, private: true,
  }, null, 2));

  // its own name and data folder, so it never mixes with a regular Drift on the same computer
  patch("src/main.js", [
    [`path.join(app.getPath("appData"), "Drift")`, `path.join(app.getPath("appData"), "Drift Legacy")`],
    [`app.setName("Drift");`, `app.setName("Drift Legacy");`],
    [`app.setAppUserModelId("Drift");`, `app.setAppUserModelId("Drift Legacy");`],
    [`minHeight: 380, title: "Drift",`, `minHeight: 380, title: "Drift Legacy",`],
    [`t.title + " - Drift"`, `t.title + " - Drift Legacy"`, "all"],
  ]);

  // Node 16 has no SQLite: importing from other browsers uses sql.js instead
  patch("src/import.js", [[`require("node:sqlite")`, `require("./legacy-sqlite")`]]);
  patch("src/import-worker.js", [
    [`const imp = require("./import");`, `require("./legacy-sqlite").ready.then(() => {\nconst imp = require("./import");`],
  ]);
  fs.appendFileSync(path.join(stage, "src", "import-worker.js"), "});\n");

  // updates: only a release with Drift Legacy files in it counts, and those are downloaded by hand
  patch("src/updater.js", [
    [`const DownloadPage = "https://lompendans.github.io/drift/";`, `const DownloadPage = "https://lompendans.github.io/drift/#legacy";`],
    [`    if (process.platform === "win32") return "setup";\n    if (process.platform === "linux" && process.env.APPIMAGE) return "appimage";\n`, ``],
    [`      if (this.kind === "manual") { this.set("manual"); return; }`,
     `      if (this.kind === "manual") { this.set((rel.assets || []).some(a => /^Drift-Legacy-/.test(a.name || "")) ? "manual" : "latest"); return; }`],
  ]);

  // the interface: its name, and a warning that stays on screen
  patch("ui/index.html", [
    [`<span class="label">Drift</span>`, `<span class="label">Drift Legacy</span>`],
    [`grid-template-rows: var(--top-h) auto auto minmax(0, 1fr);`, `grid-template-rows: var(--top-h) auto auto auto minmax(0, 1fr);`],
    [`background: color-mix(in srgb, var(--pop) 80%, transparent);`, `background: var(--pop);`],   // Chromium 100 has no color-mix()
    [`<div id="permWrap">`, `<div id="legacyBar" role="note"><svg class="i"><use href="#i-shield-off"/></svg><span id="legacyText"></span><button class="icon-btn" id="legacyHide" type="button" title="Hide until Drift restarts"><svg class="i"><use href="#i-x"/></svg></button></div>
    <div id="permWrap">`],
    [`/* ---------- filter lists ---------- */`, `/* ---------- Drift Legacy's warning ---------- */
#legacyBar { margin-bottom: var(--gap); min-height: 38px; display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 12px; border-radius: var(--radius); background: #fff1cc; color: #6b4300; font-size: 12.5px; line-height: 1.35; }
#legacyBar > .i { flex: none; color: #b26a00; }
#legacyBar span { flex: 1; min-width: 0; }
#legacyBar .icon-btn { color: #8a5a00; }
@media (prefers-color-scheme: dark) { #legacyBar { background: rgba(255, 176, 32, 0.14); color: #ffd27a; } #legacyBar > .i, #legacyBar .icon-btn { color: #ffbf47; } }
/* ---------- filter lists ---------- */`],
    [`$("#aboutLine").textContent = \`Drift \${m.drift || ""} · Chromium \${m.version || ""}\`;`,
     `$("#aboutLine").textContent = \`Drift Legacy \${m.drift || ""} · Chromium \${m.version || ""}\`;
      $("#legacyText").innerHTML = T("<b>Drift Legacy is not safe to use.</b> It runs on an old engine (Chromium {v}) that no longer gets security fixes. Don't use it for banking, shopping, email or passwords.", { v: String(m.version || "").split(".")[0] });`],
    [`postColors();\npostRect();`, `$("#legacyHide").onclick = () => { $("#legacyBar").hidden = true; followRect(400); };
postColors();
postRect();`],
  ]);
  patch("pages/newtab.html", [
    [`  <p class="empty in" id="empty" hidden>`, `  <p class="legacy in">Drift Legacy · an old engine without security fixes. Don't use it for banking, shopping, email or passwords.</p>
  <p class="empty in" id="empty" hidden>`],
    [`@media (max-width: 520px)`, `.legacy { margin: 0; padding: 8px 14px; border-radius: 10px; background: rgba(255, 176, 32, 0.16); color: #8a5a00; font-size: 12.5px; text-align: center; }
@media (prefers-color-scheme: dark) { .legacy { color: #ffd27a; } }
@media (max-width: 520px)`],
  ]);
}

async function packageFor(platform, arch) {
  const { packager } = require("@electron/packager");
  const version = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8")).version;
  const paths = await packager({
    dir: stage, out: path.join(here, "out"), overwrite: true, platform, arch,
    electronVersion: Engines[platform],
    name: "Drift Legacy", executableName: platform === "win32" ? "Drift Legacy" : "drift-legacy",
    appVersion: version, buildVersion: version,
    icon: path.join(stage, "build", platform === "win32" ? "icon.ico" : "icon.png"),
    asar: true, prune: false,
    ignore: [/^\/test($|\/)/, /^\/build\/(?!icon\.(png|ico)$)/],
    appCopyright: "Drift",
    win32metadata: { CompanyName: "Drift", FileDescription: "Drift Legacy", ProductName: "Drift Legacy", InternalName: "Drift Legacy", OriginalFilename: "Drift Legacy.exe" },
  });
  console.log(paths.join("\n"));
}

const [cmd, platform, arch] = process.argv.slice(2);
stageFiles();
if (cmd === "package") packageFor(platform, arch).catch(e => { console.error(e); process.exit(1); });
else console.log("staged in " + stage);

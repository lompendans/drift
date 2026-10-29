// Packages Drift for one platform into out/Drift-<platform>-<arch> (no installer; build-release.ps1 and
// build-linux.sh wrap it). Usage: node build/package.js [win32|linux] [x64|arm64]
const path = require("path");
const { packager } = require("@electron/packager");

const root = path.join(__dirname, "..");
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || "x64";
const pkg = require(path.join(root, "package.json"));

packager({
  dir: root,
  out: path.join(root, "out"),
  overwrite: true,
  platform, arch,
  name: "Drift",
  executableName: platform === "win32" ? "Drift" : "drift",
  appVersion: pkg.version,
  buildVersion: pkg.version,
  icon: path.join(root, "build", platform === "win32" ? "icon.ico" : "icon.png"),
  asar: true,
  prune: true,
  // only what Drift needs at run time goes in
  ignore: [/^\/test($|\/)/, /^\/out($|\/)/, /^\/dist($|\/)/, /^\/build\/(?!icon\.(png|ico)$)/, /\.md$/],
  appCopyright: "Drift",
  win32metadata: { CompanyName: "Drift", FileDescription: "Drift", ProductName: "Drift", InternalName: "Drift", OriginalFilename: "Drift.exe" },
}).then(paths => console.log(paths.join("\n"))).catch(e => { console.error(e); process.exit(1); });

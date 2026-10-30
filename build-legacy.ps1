# Builds Drift Legacy (Drift on an old engine, for computers new Drift can't run on) into .\release:
#   Drift-Legacy-windows-ia32.zip    Windows 7, 8, 8.1, 10 and 11, 32-bit (Electron 22, Chromium 108)
#   Drift-Legacy-windows-x64.zip     Windows 7, 8 and 8.1, 64-bit (Electron 22, Chromium 108)
#   Drift-Legacy-linux-ia32.tar.gz   32-bit Linux (Electron 18, Chromium 100)
# These engines no longer get security fixes; Drift Legacy says so on every screen. See legacy\build.js.
# Needs Node.js and Docker Desktop running. Run build-release.ps1 first (it sets the version). Usage: .\build-legacy.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$legacy = Join-Path $root 'legacy'
$out = Join-Path $root 'release'
New-Item -ItemType Directory -Force $out | Out-Null

Push-Location $legacy
if (-not (Test-Path 'node_modules')) { npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
Remove-Item out -Recurse -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($arch in 'ia32', 'x64') {
  node build.js package win32 $arch
  if ($LASTEXITCODE) { throw "Windows $arch build failed" }
  # the zip opens to a "Drift Legacy" folder
  $folder = Join-Path $legacy 'out\Drift Legacy'
  Rename-Item (Join-Path $legacy "out\Drift Legacy-win32-$arch") $folder
  $zip = Join-Path $out "Drift-Legacy-windows-$arch.zip"
  Remove-Item $zip -ErrorAction SilentlyContinue
  [IO.Compression.ZipFile]::CreateFromDirectory($folder, $zip, 'Optimal', $true)
  Remove-Item $folder -Recurse -Force
}
Pop-Location

# 32-bit Linux is packaged in a Linux container so file permissions come out right
$ErrorActionPreference = 'Continue'   # npm prints notices on stderr
docker run --rm -v "${root}:/src" node:24-bookworm sh /src/legacy/linux.sh
if ($LASTEXITCODE) { throw 'Linux build failed' }
$ErrorActionPreference = 'Stop'
Copy-Item (Join-Path $legacy 'out\Drift-Legacy-linux-ia32.tar.gz') $out -Force

Get-ChildItem $out -File -Filter 'Drift-Legacy-*' | ForEach-Object {
  '{0,-34} {1,14:N0} bytes  sha256 {2}' -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}

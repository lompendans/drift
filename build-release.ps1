# Builds a Drift release for Windows into .\release:
#   DriftSetup.exe        the installer (Drift's files are inside it); also what Drift's updater downloads
#   Drift-portable.zip    Drift without installing
#   Drift-online-setup.exe  a small installer that downloads Drift while installing
# The names stay the same in every release, so links to releases/latest/download/<name> always work.
# Linux files come from build-linux.ps1. Usage: .\build-release.ps1 -Version 2.0.0
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'app'
$out = Join-Path $root 'release'
$stage = Join-Path $out 'Drift'   # the portable zip opens to a 'Drift' folder

if (Get-Process Drift -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root\*" }) { throw 'Close the Drift you built here first; its files are in use.' }

# the version lives in package.json; Drift shows it and the updater compares it
Push-Location $app
npm version $Version --no-git-tag-version --allow-same-version | Out-Null
node build/package.js win32 x64
if ($LASTEXITCODE) { Pop-Location; throw 'Packaging Drift failed' }
Pop-Location

Get-ChildItem $out -File -Filter 'Drift*.exe' -ErrorAction SilentlyContinue | Remove-Item
Get-ChildItem $out -File -Filter 'Drift-portable.zip' -ErrorAction SilentlyContinue | Remove-Item
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $app 'out\Drift-win32-x64') $stage -Recurse

Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload = Join-Path $root 'installer\payload.zip'
Remove-Item $payload -ErrorAction SilentlyContinue
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, 'Optimal', $false)

$portable = Join-Path $out "Drift-portable.zip"
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $portable, 'Optimal', $true)

dotnet build "$root\installer\DriftSetup.csproj" -c Release -nologo -v q "/p:Version=$Version"
if ($LASTEXITCODE) { throw 'Installer build failed' }
$setup = Join-Path $out "DriftSetup.exe"
Copy-Item (Join-Path $root 'installer\bin\Release\net48\DriftSetup.exe') $setup
# the same installer without Drift's files inside; it downloads Drift-portable.zip from the latest release instead.
# (Its name mustn't start with "DriftSetup": Drift 1.x's updater takes any release file named DriftSetup*.exe.)
dotnet build "$root\installer\DriftSetup.csproj" -c Release -nologo -v q "/p:Version=$Version" /p:Online=true "/p:OutDir=$root/installer/bin/online/"
if ($LASTEXITCODE) { throw 'Online installer build failed' }
Copy-Item (Join-Path $root 'installer\bin\online\DriftSetup.exe') (Join-Path $out 'Drift-online-setup.exe')
Remove-Item $stage -Recurse -Force

Get-ChildItem $out -File | ForEach-Object {
  '{0,-34} {1,14:N0} bytes  sha256 {2}' -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}

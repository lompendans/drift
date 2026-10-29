# Builds Drift's Linux downloads (AppImage, .deb, .tar.gz) in a Docker container into .\release.
# Needs Docker Desktop running. Run build-release.ps1 first (it sets the version). Usage: .\build-linux.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$app = Join-Path $root 'app'
docker run --rm -v "${app}:/src" node:24-bookworm sh /src/build/linux.sh
if ($LASTEXITCODE) { throw 'Linux build failed' }
New-Item -ItemType Directory -Force (Join-Path $root 'release') | Out-Null
Copy-Item (Join-Path $app 'out\linux\*') (Join-Path $root 'release') -Force
Get-ChildItem (Join-Path $root 'release') -File | ForEach-Object {
  '{0,-34} {1,14:N0} bytes  sha256 {2}' -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}

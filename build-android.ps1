# Builds Drift for Android into .\release\Drift-android.apk, signed with Drift's release key.
# Needs the Android SDK (Android Studio installs it) and the signing key: signing\keystore.properties next to this
# script, or DRIFT_KEYSTORE pointing at one. The key must stay the same forever, or phones can't update Drift.
# Usage: .\build-android.ps1            (uses the version in app\package.json)
#        .\build-android.ps1 -Version 2.0.1
param([string]$Version)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'app\package.json') -Raw | ConvertFrom-Json).version }
if (-not $env:DRIFT_KEYSTORE -and -not (Test-Path (Join-Path $root 'signing\keystore.properties'))) { throw 'No signing key: put it in signing\keystore.properties or set DRIFT_KEYSTORE.' }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }

Push-Location (Join-Path $root 'android')
.\gradlew.bat assembleRelease --console=plain -q "-PdriftVersion=$Version"
$code = $LASTEXITCODE
Pop-Location
if ($code) { throw 'Android build failed' }

New-Item -ItemType Directory -Force (Join-Path $root 'release') | Out-Null
$apk = Join-Path $root 'release\Drift-android.apk'
Copy-Item (Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk') $apk -Force
'{0,-34} {1,14:N0} bytes  sha256 {2}' -f (Split-Path $apk -Leaf), (Get-Item $apk).Length, (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()

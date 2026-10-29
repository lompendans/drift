#!/bin/sh
# Runs inside a Linux container (see build-linux.ps1): packages Drift and makes the Linux downloads in /src/out/linux:
#   Drift-x86_64.AppImage   runs anywhere, and updates itself
#   drift_amd64.deb         for Debian, Ubuntu, Mint…
#   Drift-linux-x64.tar.gz  plain files
set -e
rm -rf /work && mkdir /work && cd /work
cp -r /src/package.json /src/package-lock.json /src/src /src/ui /src/pages /src/build .
npm ci --no-audit --no-fund --loglevel=error
node build/package.js linux x64
# the packager makes its folder private (0700); everyone needs to be able to open it once installed
chmod 755 out/Drift-linux-x64
VERSION=$(node -p "require('./package.json').version")
OUT=/src/out/linux
rm -rf "$OUT" && mkdir -p "$OUT"
tar -C out -czf "$OUT/Drift-linux-x64.tar.gz" --transform 's/^Drift-linux-x64/drift/' Drift-linux-x64
npx --yes electron-builder@26.17.0 --linux AppImage deb --x64 --prepackaged out/Drift-linux-x64 --publish never \
  -c.appId=io.github.lompendans.drift -c.productName=Drift -c.executableName=drift \
  -c.linux.category=Network -c.linux.icon=build/icon.png -c.linux.synopsis="A calm, fast browser" \
  -c.appImage.artifactName='Drift-${arch}.AppImage' -c.deb.artifactName='drift_amd64.deb' \
  -c.deb.packageName=drift -c.deb.depends='libgtk-3-0t64 | libgtk-3-0' -c.deb.depends=libnotify4 -c.deb.depends=libnss3 -c.deb.depends=libxss1 -c.deb.depends=libxtst6 -c.deb.depends=xdg-utils -c.deb.depends='libatspi2.0-0t64 | libatspi2.0-0' -c.deb.depends=libuuid1 -c.deb.depends=libsecret-1-0 -c.deb.depends='libasound2t64 | libasound2' -c.deb.depends=libgbm1 -c.deb.depends='libdrm2' -c.linux.maintainer="Drift <drift@users.noreply.github.com>" -c.directories.output=/work/dist -c.linux.syncDesktopName=true
cp /work/dist/*.AppImage /work/dist/*.deb "$OUT/"
mv "$OUT"/Drift-x64.AppImage "$OUT/Drift-x86_64.AppImage" 2>/dev/null || true
ls -la "$OUT"

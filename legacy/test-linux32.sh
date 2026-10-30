#!/bin/sh
# Tests the 32-bit Linux build in a 32-bit Debian container: unpacks it, starts it on a virtual screen, takes a screenshot.
set -e
apt-get update -qq 2>&1 | tail -2
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends xvfb imagemagick libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 libxss1 libdrm2 libxkbcommon0 libxshmfence1 libcups2 fonts-dejavu-core ca-certificates 2>&1 | tail -3
echo "userland: $(dpkg --print-architecture)"
mkdir -p /t && cd /t && tar xzf /src/legacy/out/Drift-Legacy-linux-ia32.tar.gz
file_arch=$(od -An -tx1 -j4 -N1 drift-legacy/drift-legacy | tr -d ' ')
echo "ELF class: $file_arch (01 = 32-bit)"
Xvfb :9 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 2
DISPLAY=:9 DRIFT_DATA=/tmp/dl ./drift-legacy/drift-legacy --no-sandbox >/tmp/out.txt 2>&1 &
sleep 20
DISPLAY=:9 import -window root /src/legacy/out/linux32.png
echo "running: $(pgrep -c drift-legacy || true) processes; state.json: $(test -f /tmp/dl/state.json && echo yes || echo no)"
grep -iE "error|cannot|fail" /tmp/out.txt | grep -v -iE "dbus|gpu|libva|vaapi|ERR_BLOCKED" | head -5 || true

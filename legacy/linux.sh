#!/bin/sh
# Builds Drift Legacy for 32-bit Linux inside a Linux container (so file permissions are right).
# Run from build-legacy.ps1: the repository is mounted at /src. Leaves legacy/out/Drift-Legacy-linux-ia32.tar.gz.
set -e
cd /src/legacy
node build.js package linux ia32
cd out
rm -rf drift-legacy
mv "Drift Legacy-linux-ia32" drift-legacy
chmod 755 drift-legacy drift-legacy/drift-legacy
# Chromium's sandbox helper must be owned by root and setuid to work; without it Drift Legacy needs --no-sandbox
chmod 4755 drift-legacy/chrome-sandbox
tar --owner=0 --group=0 -czf Drift-Legacy-linux-ia32.tar.gz drift-legacy
ls -l Drift-Legacy-linux-ia32.tar.gz

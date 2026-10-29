set -e
dnf install -y -q curl xorg-x11-server-Xvfb ImageMagick gtk3 nss alsa-lib libXScrnSaver libXtst mesa-libgbm libsecret fuse-libs xdg-utils google-noto-sans-fonts >/dev/null 2>&1
useradd -m tester
su tester -c 'DRIFT_BASE=file:///w/release DRIFT_ICON=file:///w/app/build/icon.png sh /w/install.sh' 2>&1 | tail -4
ls -la /home/tester/.local/share/drift /home/tester/.local/bin; cat /home/tester/.local/share/applications/drift.desktop | grep Exec
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & sleep 2
su tester -c 'DISPLAY=:99 APPIMAGE_EXTRACT_AND_RUN=1 ~/.local/bin/drift https://example.com > /tmp/f.log 2>&1 &'
sleep 18
pgrep -c drift || true
DISPLAY=:99 import -window root /w/release/f-shot.png
grep -i "fatal\|error while" /tmp/f.log | head -3
su tester -c 'sh /w/install.sh --uninstall' | tail -1

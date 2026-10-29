set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null; apt-get install -y -qq curl xvfb imagemagick >/dev/null 2>&1
DRIFT_BASE=file:///w/release sh /w/install.sh 2>&1 | grep -v "^Get:\|^Selecting\|^Preparing\|^Unpacking\|^Setting up\|^Processing" | tail -8
echo "--- which: $(command -v drift)"; ls -la /opt/Drift/chrome-sandbox
useradd -m tester
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 2
su tester -c 'DISPLAY=:99 drift https://example.com > /tmp/u.log 2>&1 &'
sleep 15
pgrep -a drift | head -3 | cut -c1-120
DISPLAY=:99 import -window root /w/release/u-shot.png
tail -20 /tmp/u.log; ls -la /home/tester/.config 2>&1 | head
echo "--- uninstall"; sh /w/install.sh --uninstall | tail -2

#!/bin/sh
# Builds, installs and opens Drift in the running emulator, then saves a screenshot.
#   ./test.sh            build + install + launch + screenshot to $TEMP/claude/a.png
#   ./test.sh shot NAME  just a screenshot
A="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
OUT="$TEMP/claude/${2:-a}.png"
if [ "$1" != shot ]; then
  export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
  ./gradlew assembleDebug --console=plain -q 2>&1 | grep -E "^e:|What went wrong" -A3 | head -20
  "$A" install -r app/build/outputs/apk/debug/app-debug.apk | tail -1
  "$A" shell am force-stop io.github.lompendans.drift
  "$A" shell am start -n io.github.lompendans.drift/.MainActivity >/dev/null
  sleep "${WAIT:-6}"
fi
"$A" exec-out screencap -p > "$OUT"
"$A" logcat -d -s AndroidRuntime:E | tail -6
# point the debugger helper (cdp.js) at the running app
S=$("$A" shell cat /proc/net/unix 2>/dev/null | grep -o "webview_devtools_remote_[0-9]*" | head -1)
[ -n "$S" ] && "$A" forward tcp:9333 localabstract:$S >/dev/null

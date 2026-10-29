#!/bin/sh
# Installs Drift on Linux.
#
#   curl -fsSL https://lompendans.github.io/drift/install.sh | sh
#
# Debian, Ubuntu, Mint and other apt systems get the .deb (asks for your password once).
# Everything else gets the AppImage in your home folder, with a menu entry; it updates itself.
#   ... | sh -s -- --appimage     use the AppImage even where apt is available
#   ... | sh -s -- --uninstall    remove Drift (your browsing data stays in ~/.config/Drift)
set -eu

REPO="lompendans/drift"
BASE="${DRIFT_BASE:-https://github.com/$REPO/releases/latest/download}"
ICON="${DRIFT_ICON:-https://lompendans.github.io/drift/icon-512.png}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPDIR="$DATA/drift"
BIN="$HOME/.local/bin"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have sudo; then sudo "$@"
  else fail "this step needs root and sudo isn't available. Re-run as root, or use --appimage."
  fi
}

mode=auto
for a in "$@"; do
  case "$a" in
    --appimage) mode=appimage ;;
    --uninstall) mode=uninstall ;;
    -h|--help) sed -n '2,11p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fail "unknown option: $a" ;;
  esac
done

uninstall() {
  removed=no
  if have dpkg && dpkg -s drift >/dev/null 2>&1; then
    say "Removing the Drift package"
    as_root apt-get remove -y drift || as_root dpkg -r drift
    removed=yes
  fi
  if [ -e "$APPDIR/Drift.AppImage" ] || [ -e "$DATA/applications/drift.desktop" ]; then
    say "Removing the Drift AppImage"
    rm -f "$APPDIR/Drift.AppImage" "$BIN/drift" "$DATA/applications/drift.desktop" "$DATA/icons/hicolor/512x512/apps/drift.png"
    rmdir "$APPDIR" 2>/dev/null || true
    removed=yes
  fi
  [ "$removed" = yes ] && say "Drift is removed. Your data is still in ~/.config/Drift; delete that folder to remove it too." || say "Drift isn't installed."
}

[ "$mode" = uninstall ] && { uninstall; exit 0; }

[ "$(uname -s)" = Linux ] || fail "this installer is for Linux. Get Drift for Windows at https://lompendans.github.io/drift/"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "Drift is built for 64-bit Intel/AMD (x86_64) Linux so far; this computer is $(uname -m)." ;;
esac
have curl || fail "curl is needed."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
chmod 755 "$tmp"   # apt reads the package as its own user

if [ "$mode" = auto ] && have apt-get && have dpkg; then
  say "Downloading Drift (.deb)"
  curl -fL --progress-bar -o "$tmp/drift_amd64.deb" "$BASE/drift_amd64.deb"
  chmod 644 "$tmp/drift_amd64.deb"
  say "Installing (this asks for your password)"
  as_root apt-get install -y "$tmp/drift_amd64.deb"
  say "Drift is installed. Open it from your apps menu, or run: drift"
  exit 0
fi

say "Downloading Drift (AppImage)"
mkdir -p "$APPDIR" "$BIN" "$DATA/applications" "$DATA/icons/hicolor/512x512/apps"
curl -fL --progress-bar -o "$tmp/Drift.AppImage" "$BASE/Drift-x86_64.AppImage"
chmod 755 "$tmp/Drift.AppImage"
mv -f "$tmp/Drift.AppImage" "$APPDIR/Drift.AppImage"
ln -sf "$APPDIR/Drift.AppImage" "$BIN/drift"
curl -fsSL -o "$DATA/icons/hicolor/512x512/apps/drift.png" "$ICON" || true

cat > "$DATA/applications/drift.desktop" <<EOF
[Desktop Entry]
Name=Drift
GenericName=Web Browser
Comment=A calm, fast browser
Exec="$APPDIR/Drift.AppImage" %U
Icon=drift
Terminal=false
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Drift
EOF
have update-desktop-database && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true

# AppImages need FUSE 2 to start; most desktops have it, some newer ones don't
if have ldconfig && ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
  printf '\n\033[1;33mnote:\033[0m Drift needs FUSE 2 to start (libfuse2). Install it with your package manager,\n      e.g. "sudo dnf install fuse-libs" or "sudo pacman -S fuse2".\n\n'
fi
case ":$PATH:" in *":$BIN:"*) ;; *) printf '\033[1;33mnote:\033[0m %s isn'"'"'t on your PATH, so open Drift from your apps menu.\n' "$BIN" ;; esac
say "Drift is installed. It updates itself; open it from your apps menu, or run: drift"

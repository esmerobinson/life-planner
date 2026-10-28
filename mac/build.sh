#!/bin/bash
# Builds mac/build/Esmeworld.app: the native Mac shell around the web app in hub/.
#
#   mac/build.sh              build the web app, then the Mac app, then self-test it
#   mac/build.sh --skip-web   reuse the existing hub/dist (no npm run build)
#   mac/build.sh --install    also copy the app to ~/Applications/Esmeworld.app
#
# Requires: node/npm (unless --skip-web), swiftc, sips, iconutil, codesign, plutil.
# Never writes to /Applications. Never touches hub/dist except via `npm run build`.

set -euo pipefail

SKIP_WEB=0
INSTALL=0
for arg in "$@"; do
    case "$arg" in
        --skip-web) SKIP_WEB=1 ;;
        --install) INSTALL=1 ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        *) echo "error: unknown option $arg" >&2; exit 2 ;;
    esac
done

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$MAC_DIR/.." && pwd)"
HUB_DIR="$REPO_DIR/hub"
BUILD_DIR="$MAC_DIR/build"
APP="$BUILD_DIR/Esmeworld.app"
CONTENTS="$APP/Contents"
ICON_SRC="$HUB_DIR/public/icons/icon-512.png"
SELFTEST_TIMEOUT=60

step() { echo ""; echo "== $1 =="; }

# --- 1. web app ---------------------------------------------------------------
step "1/7: web app (hub/dist)"
if [[ "$SKIP_WEB" == 1 ]]; then
    echo "skipped (--skip-web): using existing hub/dist"
else
    (cd "$HUB_DIR" && npm run build)
fi
if [[ ! -f "$HUB_DIR/dist/index.html" ]]; then
    echo "error: $HUB_DIR/dist/index.html is missing; run without --skip-web" >&2
    exit 1
fi

# --- 2. fresh bundle skeleton --------------------------------------------------
step "2/7: bundle skeleton"
rm -rf "$APP" "$BUILD_DIR/AppIcon.iconset"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
echo "$APP"

# --- 3. icon -------------------------------------------------------------------
step "3/7: app icon (sips + iconutil)"
ICONSET="$BUILD_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    # 512@2x (1024px) is an upscale of the 512px source; see README.
    sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
rm -rf "$ICONSET"
echo "$CONTENTS/Resources/AppIcon.icns"

# --- 4. compile ----------------------------------------------------------------
step "4/7: compile (swiftc -O)"
swiftc -swift-version 5 -O \
    -target "$(uname -m)-apple-macos13.0" \
    "$MAC_DIR/Esmeworld/main.swift" \
    -o "$CONTENTS/MacOS/Esmeworld"
echo "$CONTENTS/MacOS/Esmeworld"

# --- 5. Info.plist + web resources ----------------------------------------------
step "5/7: Info.plist and bundled web app"
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>Esmeworld</string>
    <key>CFBundleIdentifier</key>
    <string>world.esme.esmeworld</string>
    <key>CFBundleName</key>
    <string>Esmeworld</string>
    <key>CFBundleDisplayName</key>
    <string>Esmeworld</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST
plutil -lint "$CONTENTS/Info.plist"
# Copied as built (sw.js and workbox files included; they are simply unused here).
cp -R "$HUB_DIR/dist" "$CONTENTS/Resources/web"
echo "$CONTENTS/Resources/web ($(find "$CONTENTS/Resources/web" -type f | wc -l | tr -d ' ') files)"

# --- 6. sign -------------------------------------------------------------------
step "6/7: ad-hoc code signature"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "signed (ad-hoc) and verified"

# --- 7. self-test ----------------------------------------------------------------
# Two launches against the app's real (default) data store. The first resets only
# the throwaway `esmeworld-selftest` database, so run 1 must print launchCount=1 and
# run 2 launchCount=2: IndexedDB survived a quit and relaunch.
step "7/7: self-test (two launches)"
run_selftest() {
    local n="$1" reset="$2" log="$BUILD_DIR/selftest-$1.log" status=0
    echo "-- launch $n --"
    ESMEWORLD_SELFTEST=1 ESMEWORLD_SELFTEST_RESET="$reset" \
        perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$SELFTEST_TIMEOUT" \
        "$CONTENTS/MacOS/Esmeworld" >"$log" 2>&1 || status=$?
    grep '^SELFTEST ' "$log" || true
    if [[ "$status" != 0 ]]; then
        echo "error: self-test launch $n exited with status $status (full log: $log)" >&2
        exit 1
    fi
    LAST_COUNT="$(grep -o 'SELFTEST launchCount=[0-9]*' "$log" | tail -1 | cut -d= -f2)"
}
LAST_COUNT=""
run_selftest 1 1
first="$LAST_COUNT"
run_selftest 2 0
second="$LAST_COUNT"
if [[ "$first" != 1 || "$second" != 2 ]]; then
    echo "error: expected launchCount 1 then 2, got '$first' then '$second' (IndexedDB did not persist)" >&2
    exit 1
fi
echo "self-test passed: both launches exited 0; launchCount $first -> $second"

# --- install (only with --install) -----------------------------------------------
if [[ "$INSTALL" == 1 ]]; then
    step "install: ~/Applications/Esmeworld.app"
    if pgrep -x Esmeworld >/dev/null 2>&1; then
        echo "note: Esmeworld is running; quit and reopen it to use the new build"
    fi
    mkdir -p "$HOME/Applications"
    # rsync --delete replaces the old bundle's files. Her data is not in the bundle
    # (it lives in ~/Library/WebKit/world.esme.esmeworld), so this never touches it.
    rsync -a --delete "$APP/" "$HOME/Applications/Esmeworld.app/"
    echo "installed: $HOME/Applications/Esmeworld.app"
fi

echo ""
echo "done: $APP"

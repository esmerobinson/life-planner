#!/bin/bash
# Builds mac/build/Esmeworld.app: the native Mac shell around the web app in hub/.
#
#   mac/build.sh              build the web app, then the Mac app, then self-test it
#   mac/build.sh --skip-web   reuse the existing hub/dist (no npm run build)
#   mac/build.sh --install    also copy the app to ~/Applications/Esmeworld.app, and
#                             get an open Esmeworld onto it (it saves, then reloads)
#
# Signing: $ESMEWORLD_SIGN_IDENTITY if set, else a login-keychain code-signing
# identity named exactly "Esmeworld Local Signing", else ad hoc. Ad hoc is fine:
# the app never uses the login keychain (see README "Signing").
#
# Requires: node/npm (unless --skip-web), swiftc, sips, iconutil, codesign, plutil,
# security; --install also uses ditto, /usr/bin/python3 (for an atomic swap), ps
# and osascript (to tell an open Esmeworld).
# Never writes to /Applications. Never touches hub/dist except via `npm run build`.

set -euo pipefail

SKIP_WEB=0
INSTALL=0
for arg in "$@"; do
    case "$arg" in
        --skip-web) SKIP_WEB=1 ;;
        --install) INSTALL=1 ;;
        -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
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
SELFTEST_TIMEOUT=90
AUTO_SIGN_IDENTITY="Esmeworld Local Signing"

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
SWIFT_FLAGS=(-swift-version 5 -O -target "$(uname -m)-apple-macos13.0")
swiftc "${SWIFT_FLAGS[@]}" \
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
# Build ids (bug #39): a running Esmeworld compares these with the bundle on disk to
# notice a new install. Hashes of what went in, so rebuilding the same thing changes
# nothing: the web files (names and contents), and the app's source, compiler, flags
# and Info.plist (the binary itself also depends on the build folder's path).
WEB_BUILD="$(cd "$CONTENTS/Resources/web" && find . -type f -print0 | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16)"
SHELL_BUILD="$( { shasum -a 256 "$MAC_DIR/Esmeworld/main.swift" | cut -d' ' -f1; swiftc --version 2>&1; \
    echo "${SWIFT_FLAGS[*]}"; cat "$CONTENTS/Info.plist"; } | shasum -a 256 | cut -c1-16)"
plutil -insert EsmeworldWebBuild -string "$WEB_BUILD" "$CONTENTS/Info.plist"
plutil -insert EsmeworldShellBuild -string "$SHELL_BUILD" "$CONTENTS/Info.plist"
echo "build ids: web $WEB_BUILD, app $SHELL_BUILD"

# --- 6. sign -------------------------------------------------------------------
# Optional stable identity. Not needed for the keychain any more: the app hands
# WebKit its own WebCrypto master key (Application Support), so no build, ad hoc
# or not, makes macOS ask for the keychain password.
step "6/7: code signature"
SIGN_IDENTITY="${ESMEWORLD_SIGN_IDENTITY:-}"
SIGN_LABEL="$SIGN_IDENTITY (from ESMEWORLD_SIGN_IDENTITY)"
if [[ -z "$SIGN_IDENTITY" ]]; then
    LOGIN_KEYCHAIN="$(security login-keychain 2>/dev/null | tr -d ' "' || true)"
    # Valid (trusted, unexpired) code-signing identities only. Signs by SHA-1 hash,
    # so two certificates with the same name can't make codesign refuse.
    SIGN_IDENTITY="$(security find-identity -v -p codesigning ${LOGIN_KEYCHAIN:+"$LOGIN_KEYCHAIN"} 2>/dev/null \
        | grep -F "\"$AUTO_SIGN_IDENTITY\"" | head -1 | awk '{print $2}' || true)"
    SIGN_LABEL="$AUTO_SIGN_IDENTITY (login keychain, $SIGN_IDENTITY)"
    if [[ -z "$SIGN_IDENTITY" ]] && security find-identity -p codesigning ${LOGIN_KEYCHAIN:+"$LOGIN_KEYCHAIN"} 2>/dev/null \
        | grep -qF "\"$AUTO_SIGN_IDENTITY\""; then
        echo "note: \"$AUTO_SIGN_IDENTITY\" is in the keychain but not valid (not trusted, or expired); signing ad hoc instead (that is fine)"
    fi
fi
if [[ -n "$SIGN_IDENTITY" ]]; then
    codesign --force --deep --sign "$SIGN_IDENTITY" "$APP"
    codesign --verify --deep --strict "$APP"
    echo "signed with $SIGN_LABEL and verified"
else
    codesign --force --deep --sign - "$APP"
    codesign --verify --deep --strict "$APP"
    echo "signed (ad-hoc) and verified"
fi

# --- 7. self-test ----------------------------------------------------------------
# Two launches against the self-test's own persistent data store
# (WKWebsiteDataStore(forIdentifier:)), never her real one, so this works while
# her Esmeworld is open. The first launch deletes that store, so run 1 must print
# launchCount=1 and run 2 launchCount=2: IndexedDB survived a quit and relaunch.
# It also deletes the self-test's own WebCrypto master key file (never hers), so
# run 1 must create it and run 2 load it, and run 2 must open the CryptoKey run 1
# stored: the master key, and keys wrapped with it, survive a relaunch.
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
    LAST_MASTER="$(grep -o 'SELFTEST masterKey=[a-z]*' "$log" | tail -1 | cut -d= -f2)"
}
LAST_COUNT=""
LAST_MASTER=""
run_selftest 1 1
first="$LAST_COUNT"; first_master="$LAST_MASTER"
run_selftest 2 0
second="$LAST_COUNT"; second_master="$LAST_MASTER"
if [[ "$first" != 1 || "$second" != 2 ]]; then
    echo "error: expected launchCount 1 then 2, got '$first' then '$second' (IndexedDB did not persist)" >&2
    exit 1
fi
if [[ "$first_master" != created || "$second_master" != loaded ]]; then
    echo "error: expected the self-test master key created then loaded, got '$first_master' then '$second_master'" >&2
    exit 1
fi
if ! grep -q '^SELFTEST webcrypto.stored=existing storedOnLaunch=1 thisLaunch=2$' "$BUILD_DIR/selftest-2.log"; then
    echo "error: launch 2 did not open the CryptoKey launch 1 stored" >&2
    exit 1
fi
echo "self-test passed: both launches exited 0; launchCount $first -> $second; master key $first_master -> $second_master; stored CryptoKey reopened"

# --- install (only with --install) -----------------------------------------------
if [[ "$INSTALL" == 1 ]]; then
    step "install: ~/Applications/Esmeworld.app"
    # Copy next to the target first, then swap it in with one rename, so a running
    # Esmeworld (which keeps its old files open) never sees a half-written bundle.
    # Her data is not in the bundle (it lives in ~/Library/WebKit/world.esme.esmeworld),
    # so this never touches it.
    DEST_DIR="$HOME/Applications"
    DEST="$DEST_DIR/Esmeworld.app"
    mkdir -p "$DEST_DIR"
    STAGE="$(mktemp -d "$DEST_DIR/.Esmeworld-install.XXXXXX")"
    trap 'rm -rf "$STAGE"' EXIT
    ditto "$APP" "$STAGE/Esmeworld.app"
    if [[ -e "$DEST" ]]; then
        # Atomic swap of the new bundle and the old one (renamex_np RENAME_SWAP).
        /usr/bin/python3 -c '
import ctypes, sys
libc = ctypes.CDLL(None, use_errno=True)
if libc.renamex_np(sys.argv[1].encode(), sys.argv[2].encode(), 0x2) != 0:
    e = ctypes.get_errno(); sys.exit("renamex_np: " + __import__("os").strerror(e))
' "$STAGE/Esmeworld.app" "$DEST"
    else
        mv "$STAGE/Esmeworld.app" "$DEST"
    fi
    rm -rf "$STAGE"   # now holds the old bundle (if any)
    trap - EXIT
    echo "installed: $DEST"

    # A running Esmeworld picks up the new version (bug #39): never killed; see the script.
    step "install: the open Esmeworld"
    "$MAC_DIR/tell-running-app.sh" "$DEST"
fi

echo ""
echo "done: $APP"

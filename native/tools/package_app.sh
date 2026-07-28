#!/bin/bash
# Builds and packages the EsmeDay menu-bar app into /Applications/EsmeDay.app.
#
# Run from anywhere; paths are resolved relative to this script's location.
# Requires: swiftc, sips, iconutil, codesign (all part of Xcode command line
# tools). Writes to /Applications/EsmeDay.app -- if that requires elevated
# permissions on your machine, run with sudo; on a normal user-owned
# /Applications install (the common case) no sudo is needed.
#
# Safe to run while EsmeDay is already running: this script only overwrites
# files on disk, it never signals or relaunches the running process. macOS
# lets an already-running process keep using its old on-disk binary/resources
# (they stay mapped/open), so this won't crash the live app. Quit + reopen
# EsmeDay yourself afterwards to pick up the changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP="/Applications/EsmeDay.app"
CONTENTS="$APP/Contents"

echo "== 1/5: building binary =="
swiftc -swift-version 5 -O "$NATIVE_DIR/main.swift" -o "$NATIVE_DIR/EsmeDay"
echo "built $NATIVE_DIR/EsmeDay"

echo "== 2/5: generating app icon =="
"$SCRIPT_DIR/make_icon.sh"

if [[ ! -d "$APP" ]]; then
    echo "error: $APP does not exist -- this script updates an existing bundle, it does not create one from scratch" >&2
    exit 1
fi

if ps aux | grep -i "[E]sme[D]ay" >/dev/null 2>&1 || pgrep -x EsmeDay >/dev/null 2>&1; then
    echo "note: EsmeDay is currently running -- updating files on disk only, not touching the running process"
fi

echo "== 3/5: copying binary and resources =="
mkdir -p "$CONTENTS/MacOS"
cp "$NATIVE_DIR/EsmeDay" "$CONTENTS/MacOS/EsmeDay"
chmod +x "$CONTENTS/MacOS/EsmeDay"

mkdir -p "$CONTENTS/Resources/Assets/Icons"
mkdir -p "$CONTENTS/Resources/Assets/Sprites"
mkdir -p "$CONTENTS/Resources/Assets/Font"
mkdir -p "$CONTENTS/Resources/Assets/Border"
mkdir -p "$CONTENTS/Resources/Fonts"

rsync -a --delete "$NATIVE_DIR/Assets/Icons/" "$CONTENTS/Resources/Assets/Icons/"
rsync -a --delete "$NATIVE_DIR/Assets/Sprites/" "$CONTENTS/Resources/Assets/Sprites/"
rsync -a --delete "$NATIVE_DIR/Assets/Font/" "$CONTENTS/Resources/Assets/Font/"
rsync -a --delete "$NATIVE_DIR/Assets/Border/" "$CONTENTS/Resources/Assets/Border/"
cp "$NATIVE_DIR/Fonts/Avatar Airbender.ttf" "$CONTENTS/Resources/Fonts/Avatar Airbender.ttf"
cp "$NATIVE_DIR/Assets/AppIcon.icns" "$CONTENTS/Resources/AppIcon.icns"

echo "== 4/5: updating Info.plist =="
PLIST="$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconFile" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleIconName string AppIcon" "$PLIST"

echo "== 5/5: re-signing (ad-hoc) =="
codesign --force --deep --sign - "$APP"

# Touch the bundle so Finder/LaunchServices notice the icon change promptly.
touch "$APP"

echo ""
echo "success: $APP updated"
echo "  - binary:    $CONTENTS/MacOS/EsmeDay"
echo "  - assets:    $CONTENTS/Resources/Assets/{Icons,Sprites,Font}"
echo "  - font:      $CONTENTS/Resources/Fonts/Avatar Airbender.ttf"
echo "  - app icon:  $CONTENTS/Resources/AppIcon.icns (CFBundleIconFile/CFBundleIconName set)"
echo "  - signed:    ad-hoc (codesign --sign -)"
echo ""
echo "If EsmeDay is currently running, quit and reopen it to see the changes."

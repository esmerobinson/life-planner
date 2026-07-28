#!/bin/bash
# Generates the macOS AppIcon.icns from native/Assets/Icons/lotus.png.
#
# Run from anywhere; paths below are resolved relative to this script's location,
# so `native/tools/make_icon.sh` works whether invoked from the repo root or from
# native/.
#
# Output (gitignored, lives under native/Assets/ which is already excluded via
# .gitignore):
#   native/Assets/AppIcon.iconset/   -- the assembled iconset folder
#   native/Assets/AppIcon.icns       -- the compiled icon, ready to drop into
#                                        Contents/Resources/AppIcon.icns
#
# The source lotus.png is only 128x128, so sizes above that are upscaled with
# sips's nearest-neighbor-ish scaling; the resulting pixelation is expected and
# matches the pixel-art aesthetic of the rest of the app's assets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$NATIVE_DIR/Assets/Icons/lotus.png"
ICONSET="$NATIVE_DIR/Assets/AppIcon.iconset"
ICNS="$NATIVE_DIR/Assets/AppIcon.icns"

if [[ ! -f "$SRC" ]]; then
    echo "error: source icon not found at $SRC" >&2
    exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# name:size pairs, standard .iconset naming.
declare -a SPECS=(
    "icon_16x16:16"
    "icon_16x16@2x:32"
    "icon_32x32:32"
    "icon_32x32@2x:64"
    "icon_128x128:128"
    "icon_128x128@2x:256"
    "icon_256x256:256"
    "icon_256x256@2x:512"
    "icon_512x512:512"
    "icon_512x512@2x:1024"
)

for spec in "${SPECS[@]}"; do
    name="${spec%%:*}"
    size="${spec##*:}"
    sips -z "$size" "$size" "$SRC" --out "$ICONSET/${name}.png" >/dev/null
    echo "generated ${name}.png (${size}x${size})"
done

rm -f "$ICNS"
iconutil -c icns "$ICONSET" -o "$ICNS"

echo "wrote $ICNS"

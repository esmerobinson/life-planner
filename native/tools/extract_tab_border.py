# native/tools/extract_tab_border.py
# Crops + cleans the new ornate red Chinese-style corner-bracket border reference
# (~/Downloads/border_inspo_chinese_style.png, 900x598) for use as a 9-slice-able
# border around the whole tab/window content area.
#
# Unlike the other extraction scripts in this folder, this source file has NO real
# alpha transparency -- it's a flat RGB image where the "transparent" interior is
# actually a baked-in checkerboard pattern alternating between white (255,255,255)
# and light gray (230,230,230). We chroma-key BOTH of those colors to transparent
# (chaining two chroma_key_transparent calls works correctly here: each call only
# overwrites alpha for its own matched pixels and preserves the existing alpha
# channel everywhere else -- see extract_common.py -- so composing two single-color
# calls is equivalent to a real two-color key, with no change needed to that shared
# helper and no risk to its existing single-color callers, e.g. extract_border.py).
#
# The border linework ships bright red; recolored to the app's dark red-brown
# (#6E1700) to match the app's text color, per explicit request.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent, recolor_lineart
from PIL import Image

SRC = os.path.expanduser("~/Downloads/border_inspo_chinese_style.png")
OUT = "native/Assets/Border"
# real, controller-measured content bounding box (drops the few stray px of margin
# around the checkerboard sheet itself)
CONTENT_RECT = (8, 8, 887, 591)
WHITE_BG = (255, 255, 255)
GRAY_BG = (230, 230, 230)
DARK_RED_BROWN = (0x6E, 0x17, 0x00)   # #6E1700, same as `bright` in main.swift

# The source art's ornate corner motif is ~170px deep on the 879x583 crop -- fine
# for a large poster-sized frame. An earlier pass here used SCALE=0.4 (68px final
# corner depth), which -- confirmed via a real screenshot on a live test build --
# was still far too thick for a ~370-420pt popup: the dense interlocking-square
# corner motif (measured >50% opaque pixel coverage within its own 68x68 corner
# block) visually swallowed the tab bar/mascot row and the top of the scrollable
# content underneath, since TabBorderFrame overlays the ENTIRE RootView. Scaled
# down further here so the final corner depth is ~16px -- thin enough to read as a
# crisp accent bracket instead of a solid red block. See TabBorderFrame in
# main.swift for the matching (scaled-down) capInsets, measured directly off the
# generated PNG (not guessed) after each change to this factor.
SCALE = 16 / 170


def process():
    im = Image.open(SRC).convert("RGB")
    piece = crop(im, CONTENT_RECT)
    piece = chroma_key_transparent(piece, bg_rgb=WHITE_BG, tol=40)
    piece = chroma_key_transparent(piece, bg_rgb=GRAY_BG, tol=40)
    piece = recolor_lineart(piece, DARK_RED_BROWN)
    piece = piece.resize((round(piece.width * SCALE), round(piece.height * SCALE)), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, "tab_border.png")
    piece.save(out_path)
    print(f"wrote {out_path} ({piece.width}x{piece.height}) from {CONTENT_RECT}, scaled {SCALE}x")


if __name__ == "__main__":
    process()

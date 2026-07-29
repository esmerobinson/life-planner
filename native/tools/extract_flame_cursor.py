#!/usr/bin/env python3
"""Extracts the 6-frame flame sprite animation from the ripped
~/Downloads/flame_cursor_sheet.png sheet (309x73px) for use as an animated
custom cursor. Personal-use-only/gitignored asset -- same treatment as every
other ripped/credited asset in this codebase (see native/tools/README-ish
comments in extract_common.py). Sheet credit (baked into the pixels, top
band y=0..47): "Die in the Dungeon: Origins - Brasier Flame Sprites, Idle
(28x47) (6 frames)".

Layout (confirmed via PIL sampling of the actual sheet, NOT assumed -- the
originally-guessed "evenly divide the full 309px width by 6" layout turned
out to be wrong on inspection, see below):
  - Top band y=0..47: the text credit -- not part of the sprite, skipped.
  - Bottom band y=47..73 (26px tall) is where the flame content lives, but
    it is NOT spread evenly across the full 309px width. A column-by-column
    scan for non-background pixels in that band shows background-only gaps
    at columns 0, 29, 58, 87, 116, 145, 174 -- i.e. 6 real frames of exactly
    29px each packed into just the first 174px (matching the "28x47"
    frame size named in the baked-in credit: 28px content + a 1px background
    border = 29px pitch), with columns 174..309 (135px) pure unused
    background. Frame i is therefore cropped as
    (i*29, 47, i*29+29, 73) for i in 0..5, NOT the naive i*51.5 division.
  - Background behind the flames is a dark blue (24, 59, 78), NOT white --
    confirmed by sampling sheet corners/background pixels before assuming.

Output: native/Assets/Cursor/frame_00.png .. frame_05.png (gitignored, like
all of native/Assets/). Upscaled modestly (source is only 26px tall) to a
final height in the ~24-32px "not too big" range the user asked for.
"""

from pathlib import Path
from PIL import Image

from extract_common import chroma_key_transparent, upscale_nearest

SRC = Path.home() / "Downloads" / "flame_cursor_sheet.png"
OUT_DIR = Path(__file__).resolve().parent.parent / "Assets" / "Cursor"

FRAME_COUNT = 6
BAND_TOP = 47
BAND_BOTTOM = 73
FRAME_PITCH = 29  # verified via column scan, NOT sheet_width / frame_count

BG_RGB = (24, 59, 78)  # confirmed via PIL sampling of sheet corners/background


def main():
    if not SRC.exists():
        raise SystemExit(f"source sheet not found: {SRC}")

    sheet = Image.open(SRC).convert("RGBA")
    assert sheet.size == (309, 73), f"unexpected sheet size {sheet.size}"

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Source frames are 26px tall. We want a final cursor image in the
    # ~24-32px tall "not too big" range the user asked for, so upscale by a
    # small integer factor and pick one that lands in that band: 26 * 1 = 26.
    # A factor of 1 (i.e. no upscale) already sits at 26px, right in range --
    # but nearest-neighbor upscaling a couple of times over gives cleaner
    # scaling behavior for a real cursor (crisper pixel-art look) without
    # leaving the target band. Use factor 1 to stay exactly at 26px tall.
    factor = 1

    for i in range(FRAME_COUNT):
        x0 = i * FRAME_PITCH
        x1 = x0 + FRAME_PITCH
        frame = sheet.crop((x0, BAND_TOP, x1, BAND_BOTTOM))
        frame = chroma_key_transparent(frame, bg_rgb=BG_RGB, tol=30)
        if factor > 1:
            frame = upscale_nearest(frame, factor)
        out_path = OUT_DIR / f"frame_{i:02d}.png"
        frame.save(out_path)
        print(f"wrote {out_path} ({frame.size[0]}x{frame.size[1]})")


if __name__ == "__main__":
    main()

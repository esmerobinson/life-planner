# native/tools/extract_font_letters.py
"""Extract the bitmap pixel font (A-Z, a-z) from docs/superpowers/fontsavatar.png.

The sheet is a green-screen (RGB 0,119,0) rip that contains the actual font
glyphs in the top-left region plus a bunch of unrelated UI preview elements
(text labels, arrows, boxes, credits) elsewhere on the sheet. This script only
extracts the 52 real letter glyphs and ignores everything else.

Row/column bands were located via pixel-content-band detection (content =
pixels far enough from the green background) restricted to the left letter
column (x < 220), which cleanly separates the 6 letter rows:
  A-I, J-R, S-Z (uppercase) and a-i, j-r, s-z (lowercase)
from the "Enter names:/OPTIONS/CONTINUE/Display/Credits" UI text sitting to
the right at similar y-offsets (which, if not excluded, merges the row-band
detection into useless blobs).

Uppercase rows have no ascenders/descenders bridging rows, so their row
y-bands are clean gaps. Lowercase rows are trickier: a letter's column
x-range can coincidentally overlap a *different* letter's column one row up
or down (e.g. lowercase h's column overlaps lowercase p's column one row
down; k's overlaps uppercase T's one row up), and descenders/serifs mean
there's no single fixed y split that cleanly separates every column without
slicing through a neighboring letter. To handle this robustly, each column
is searched over a generous y-window spanning multiple rows, split into
blank-row-separated runs, and the run whose vertical midpoint is closest to
that row's nominal center (from ROWS below) is picked as the glyph -- this
naturally throws out a neighboring row's letter fragment that happens to
share the same x-range, since it forms its own separate run further away
from the target row's center.

Output naming: macOS's default case-insensitive filesystem means A.png and
a.png collide, so uppercase letters are saved as upper_A.png ... upper_Z.png
and lowercase as lower_a.png ... lower_z.png.
"""
import sys, os
sys.path.insert(0, "native/tools")
from PIL import Image, ImageDraw
import numpy as np
from extract_common import chroma_key_transparent, upscale_nearest

SRC = "docs/superpowers/fontsavatar.png"
OUT = "native/Assets/Font"
BG = (0, 119, 0)
TOL = 30
UPSCALE = 4
LETTER_COLUMN_X_MAX = 220  # excludes the UI preview text/labels to the right

# (row label, letters, tight y-band used for column detection)
ROWS = [
    ("A-I", "ABCDEFGHI", (8, 26)),
    ("J-R", "JKLMNOPQR", (26, 43)),
    ("S-Z", "STUVWXYZ", (43, 60)),
    ("a-i", "abcdefghi", (77, 93)),
    ("j-r", "jklmnopqr", (93, 113)),
    ("s-z", "stuvwxyz", (113, 129)),
]


def content_mask(im: Image.Image) -> np.ndarray:
    arr = np.array(im.convert("RGB"))
    diff = np.abs(arr.astype(int) - np.array(BG)).sum(axis=2)
    return diff > TOL


def col_bands(mask: np.ndarray, y0: int, y1: int, x0: int = 0, x1: int = LETTER_COLUMN_X_MAX):
    """Find contiguous x-ranges with content within mask[y0:y1, x0:x1]."""
    sub = mask[y0:y1, x0:x1]
    col_has = sub.any(axis=0)
    bands = []
    in_band = False
    start = 0
    for x in range(x1 - x0):
        if col_has[x] and not in_band:
            start = x
            in_band = True
        elif not col_has[x] and in_band:
            bands.append((start + x0, x + x0))
            in_band = False
    if in_band:
        bands.append((start + x0, x1))
    return bands


def row_runs(mask: np.ndarray, x0: int, x1: int, y_search0: int, y_search1: int):
    """Within column x0:x1, find contiguous (blank-row-separated) y-runs of
    content over the wide search window [y_search0, y_search1)."""
    col_has = mask[y_search0:y_search1, x0:x1].any(axis=1)
    runs = []
    in_run = False
    start = 0
    for i, v in enumerate(col_has):
        if v and not in_run:
            start = i
            in_run = True
        elif not v and in_run:
            runs.append((y_search0 + start, y_search0 + i))
            in_run = False
    if in_run:
        runs.append((y_search0 + start, y_search1))
    return runs


def glyph_bbox(mask: np.ndarray, x0: int, x1: int, row_y0: int, row_y1: int,
               y_search0: int, y_search1: int, pad: int = 2):
    """Tight content bounding box for one letter's column, picking the
    blank-row-separated run closest to this row's nominal vertical center
    (so a same-column fragment belonging to a neighboring row is excluded)."""
    runs = row_runs(mask, x0, x1, y_search0, y_search1)
    if not runs:
        raise RuntimeError(f"No content runs found in column ({x0},{x1})")
    row_center = (row_y0 + row_y1) / 2
    ry0, ry1 = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - row_center))

    sub = mask[ry0:ry1, x0:x1]
    ys, xs = np.where(sub)
    bx0 = max(0, xs.min() - pad)
    bx1 = min(x1 - x0, xs.max() + 1 + pad)
    by0 = max(0, ys.min() - pad)
    by1 = min(ry1 - ry0, ys.max() + 1 + pad)
    return (x0 + bx0, ry0 + by0, x0 + bx1, ry0 + by1)


def out_name(letter: str) -> str:
    return f"upper_{letter}.png" if letter.isupper() else f"lower_{letter}.png"


def write_overview(sheet: Image.Image, boxes):
    overview = sheet.convert("RGB").copy()
    draw = ImageDraw.Draw(overview)
    for letter, box in boxes:
        draw.rectangle(box, outline=(255, 0, 0), width=1)
        draw.text((box[0], max(0, box[1] - 9)), letter, fill=(255, 0, 0))
    overview.save(os.path.join(OUT, "_overview.png"))


# Wide y-search window each row group's columns are searched over, so a
# blank-separated run belonging to a neighboring row can still be found (and
# then rejected in favor of the run closest to that row's own center).
UPPER_SEARCH = (0, 65)
LOWER_SEARCH = (70, 135)


def main():
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.open(SRC).convert("RGB")
    mask = content_mask(sheet)

    boxes = []
    produced = []
    for row_label, letters, (ry0, ry1) in ROWS:
        bands = col_bands(mask, ry0, ry1)
        if len(bands) != len(letters):
            raise RuntimeError(
                f"Row {row_label}: expected {len(letters)} column bands, found {len(bands)}: {bands}"
            )
        y_search = UPPER_SEARCH if ry0 < 65 else LOWER_SEARCH
        for letter, (cx0, cx1) in zip(letters, bands):
            box = glyph_bbox(mask, cx0, cx1, ry0, ry1, *y_search, pad=2)
            boxes.append((letter, box))
            glyph = sheet.crop(box)
            glyph = chroma_key_transparent(glyph, bg_rgb=BG, tol=TOL)
            glyph = upscale_nearest(glyph, UPSCALE)
            fname = out_name(letter)
            glyph.save(os.path.join(OUT, fname))
            produced.append(fname)

    write_overview(sheet, boxes)
    print(f"Wrote {len(produced)} letter glyphs to {OUT}/")
    for fname in produced:
        print(" ", fname)


if __name__ == "__main__":
    main()

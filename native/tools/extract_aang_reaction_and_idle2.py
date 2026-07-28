# native/tools/extract_aang_reaction_and_idle2.py
# Replaces the old auto-cropped "idle" walk-cycle with a hand-picked resting-pose
# sheet, and adds a new one-shot "reaction" sequence (airbend attack) that plays
# once whenever a task gets ticked complete. See MascotModel/.reaction in main.swift.
#
# Frame alignment: slice each frame at a FIXED absolute x-position (full sheet
# width / frame_count), do NOT independently detect/recenter each frame's own
# content bbox. An earlier version of this script cropped each frame to its own
# post-chroma-key content bbox and recentered it onto a shared canvas -- that
# looked reasonable in isolation but actually broke alignment: the character's
# anchor point shifted frame-to-frame depending on how wide that particular
# frame's detected content happened to be, and adjacent frames' slices weren't
# always disjoint, so two poses could bleed into one frame. Plain fixed-width
# slicing keeps the character's body position stable across frames (accepting
# a minor cosmetic sliver of the neighboring pose at some edges, since the
# source poses touch with near-zero gap at the pixel level -- same known,
# accepted limitation as the existing "splash" sequence).
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

IDLE_SRC = os.path.expanduser("~/Downloads/aang_idle_resting.png")
REACTION_SRC = os.path.expanduser("~/Downloads/aang_reaction_airbend.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# name -> (source path, y-crop (y0, y1), frame_count)
# x is always sliced across the FULL sheet width (0..sheet_width), divided
# evenly by frame_count -- y is cropped to the measured content band, which is
# the same for every frame so it doesn't introduce any per-frame drift.
SEQUENCES = {
    "idle":     (IDLE_SRC,     (24, 195), 8),
    "reaction": (REACTION_SRC, (35, 175), 7),
}


def slice_frames(im, y_range, count):
    y0, y1 = y_range
    sheet_w = im.width
    w = sheet_w / count
    frames = []
    for i in range(count):
        fx0 = round(i * w)
        fx1 = round((i + 1) * w)
        frames.append(im.crop((fx0, y0, fx1, y1)))
    return frames


def process(name, src_path, y_range, count):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    # wipe any stale frames from a previous (possibly different frame-count) sequence
    for f in os.listdir(folder):
        if f.startswith("frame_") and f.endswith(".png"):
            os.remove(os.path.join(folder, f))

    sheet = Image.open(src_path).convert("RGB")
    raw_frames = slice_frames(sheet, y_range, count)

    for i, raw in enumerate(raw_frames):
        keyed = chroma_key_transparent(raw, bg_rgb=(255, 255, 255), tol=30)
        upscaled = upscale_nearest(keyed, UPSCALE)
        upscaled.save(os.path.join(folder, f"frame_{i:02d}.png"))

    fw = sheet.width / count
    print(f"{name}: wrote {count} frames, {fw:.1f}px wide x {y_range[1]-y_range[0]}px tall "
          f"(upscaled {round(fw*UPSCALE)}x{(y_range[1]-y_range[0])*UPSCALE})")


def write_overview():
    """Draws a red box around every frame slice, on its own source sheet, for
    visual review (one panel per sheet, stacked into a single _overview.png)."""
    panels = []
    for name, (src_path, y_range, count) in SEQUENCES.items():
        sheet = Image.open(src_path).convert("RGB")
        overview = sheet.copy()
        draw = ImageDraw.Draw(overview)
        y0, y1 = y_range
        w = sheet.width / count
        for i in range(count):
            fx0 = round(i * w)
            fx1 = round((i + 1) * w)
            draw.rectangle((fx0, y0, fx1, y1), outline=(255, 0, 0), width=2)
        draw.text((4, max(0, y0 - 14)), f"{name} ({count})", fill=(255, 0, 0))
        panels.append(overview)

    total_h = sum(p.height for p in panels) + 10 * (len(panels) - 1)
    max_w = max(p.width for p in panels)
    combined = Image.new("RGB", (max_w, total_h), (30, 30, 30))
    y = 0
    for p in panels:
        combined.paste(p, (0, y))
        y += p.height + 10
    combined.save(os.path.join(OUT, "_overview.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_overview()
    for name, (src_path, y_range, count) in SEQUENCES.items():
        process(name, src_path, y_range, count)

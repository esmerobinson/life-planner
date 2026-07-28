# native/tools/extract_aang_reaction_and_idle2.py
# Replaces the old auto-cropped "idle" walk-cycle with a hand-picked resting-pose
# sheet, and adds a new one-shot "reaction" sequence (airbend attack) that plays
# once whenever a task gets ticked complete. See MascotModel/.reaction in main.swift.
#
# Frame alignment history (see git log for the two prior broken attempts):
#   1. Cropping each frame to its own post-chroma-key content bbox and
#      recentering it onto a shared max-size canvas broke alignment -- the
#      character's anchor shifted frame-to-frame depending on how wide that
#      particular frame's detected content happened to be, producing visible
#      double-character overlap in several frames.
#   2. Switching to even fixed-width slicing (sheet_width / frame_count) was
#      still wrong for the idle sheet specifically: its 8 poses are NOT evenly
#      spaced -- they vary from ~160px down to ~104px wide partway through the
#      sequence -- so a uniform 142.5px slice still cut across pose boundaries
#      for the narrower later frames, reproducing the same double-character
#      overlap (confirmed on frame index 4).
#   3. (current) Idle now uses IDLE_BOUNDARIES below: 8 literal x-boundaries
#      measured directly off the sheet's real column-density profile (gaps
#      between poses), rather than assuming uniform spacing. Reaction's 7
#      poses were spot-checked and found evenly spaced, so it keeps even
#      division across the full sheet width.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

IDLE_SRC = os.path.expanduser("~/Downloads/aang_idle_resting.png")
REACTION_SRC = os.path.expanduser("~/Downloads/aang_reaction_airbend.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# Measured directly off aang_idle_resting.png's column-density profile: real
# gaps (local density minima) between the 8 poses, NOT evenly spaced (segment
# widths run 160,154,154,155,159,127,104,105px -- poses shrink noticeably
# partway through the sequence).
IDLE_BOUNDARIES = [0, 160, 314, 468, 623, 782, 909, 1013, 1118]

IDLE_Y = (24, 195)
REACTION_Y = (35, 175)
REACTION_COUNT = 7


def slice_idle(im):
    y0, y1 = IDLE_Y
    return [im.crop((IDLE_BOUNDARIES[i], y0, IDLE_BOUNDARIES[i + 1], y1))
            for i in range(len(IDLE_BOUNDARIES) - 1)]


def slice_reaction(im):
    y0, y1 = REACTION_Y
    w = im.width / REACTION_COUNT
    frames = []
    for i in range(REACTION_COUNT):
        fx0 = round(i * w)
        fx1 = round((i + 1) * w)
        frames.append(im.crop((fx0, y0, fx1, y1)))
    return frames


def process(name, src_path, slicer):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    # wipe any stale frames from a previous (possibly different frame-count) sequence
    for f in os.listdir(folder):
        if f.startswith("frame_") and f.endswith(".png"):
            os.remove(os.path.join(folder, f))

    sheet = Image.open(src_path).convert("RGB")
    raw_frames = slicer(sheet)

    for i, raw in enumerate(raw_frames):
        keyed = chroma_key_transparent(raw, bg_rgb=(255, 255, 255), tol=30)
        upscaled = upscale_nearest(keyed, UPSCALE)
        upscaled.save(os.path.join(folder, f"frame_{i:02d}.png"))

    sizes = [f.size for f in raw_frames]
    print(f"{name}: wrote {len(raw_frames)} frames, sizes={sizes}")


def write_overview():
    """Draws a red box around every frame slice, on its own source sheet, for
    visual review (one panel per sheet, stacked into a single _overview.png)."""
    panels = []

    idle_sheet = Image.open(IDLE_SRC).convert("RGB")
    overview = idle_sheet.copy()
    draw = ImageDraw.Draw(overview)
    y0, y1 = IDLE_Y
    for i in range(len(IDLE_BOUNDARIES) - 1):
        draw.rectangle((IDLE_BOUNDARIES[i], y0, IDLE_BOUNDARIES[i + 1], y1), outline=(255, 0, 0), width=2)
    draw.text((4, max(0, y0 - 14)), f"idle ({len(IDLE_BOUNDARIES) - 1})", fill=(255, 0, 0))
    panels.append(overview)

    reaction_sheet = Image.open(REACTION_SRC).convert("RGB")
    overview = reaction_sheet.copy()
    draw = ImageDraw.Draw(overview)
    y0, y1 = REACTION_Y
    w = reaction_sheet.width / REACTION_COUNT
    for i in range(REACTION_COUNT):
        fx0 = round(i * w)
        fx1 = round((i + 1) * w)
        draw.rectangle((fx0, y0, fx1, y1), outline=(255, 0, 0), width=2)
    draw.text((4, max(0, y0 - 14)), f"reaction ({REACTION_COUNT})", fill=(255, 0, 0))
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
    process("idle", IDLE_SRC, slice_idle)
    process("reaction", REACTION_SRC, slice_reaction)

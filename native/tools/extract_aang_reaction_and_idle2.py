# native/tools/extract_aang_reaction_and_idle2.py
# Replaces the old auto-cropped "idle" walk-cycle with a hand-picked resting-pose
# sheet, adds a one-shot "reaction" sequence (airbend attack) that plays once
# whenever a task gets ticked complete, and a "standing" sequence (the original
# clean 7-frame walk cycle) used for the hover state. See MascotModel in main.swift.
#
# Frame alignment history (see git log for the prior broken attempts):
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
#   3. Idle now uses IDLE_BOUNDARIES below: 8 literal x-boundaries measured
#      directly off the sheet's real column-density profile (gaps between
#      poses), rather than assuming uniform spacing. This fixed the crop
#      alignment, but a SEPARATE bug remained: each cropped frame kept its own
#      natural width, and SwiftUI's SpriteAnimator renders every frame into a
#      fixed 90x90 `.resizable()` frame with no `.aspectRatio()` -- so frames
#      that were genuinely narrower than others got stretched wider to fill
#      that box, making the character visibly "grow" between frames.
#   4. (current) Fix the growing/shrinking artifact WITHOUT reintroducing #1's
#      overlap bug: after cropping+chroma-keying, pad every frame in a sequence
#      out to that sequence's max width/height using a transparent canvas,
#      anchored at (0, 0) -- i.e. padding is only ever added on the RIGHT/BOTTOM
#      side, never used to recenter content. Since these are absolute
#      pixel-position crops off the source sheet, anchoring at the top-left
#      preserves each frame's already-correct alignment; it just gives every
#      frame in the sequence identical canvas dimensions, so `.resizable()`
#      stretches them all by the same fixed factor instead of a per-frame one.
#      Also corrected the reaction sheet's crop boundaries (REACTION_RECTS
#      below) -- the previous even-division slicing across the full sheet
#      width was wrong: there's a genuine empty gap partway through that sheet
#      (not just touching poses), so explicit (x0, x1) pairs are used instead,
#      measured via column-density analysis and verified to produce clean
#      single-character crops. Also added "standing": the original clean
#      7-frame walk cycle (used as idle in an earlier version of this
#      project), for the new hover state.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

IDLE_SRC = os.path.expanduser("~/Downloads/aang_idle_resting.png")
REACTION_SRC = os.path.expanduser("~/Downloads/aang_reaction_airbend.png")
STANDING_SRC = os.path.expanduser("~/Downloads/Avatar Aang Playable Characters.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# Measured directly off aang_idle_resting.png's column-density profile: real
# gaps (local density minima) between the 8 poses, NOT evenly spaced (segment
# widths run 160,154,154,155,159,127,104,105px -- poses shrink noticeably
# partway through the sequence).
IDLE_BOUNDARIES = [0, 160, 314, 468, 623, 782, 909, 1013, 1118]
IDLE_Y = (24, 195)

# Explicit (x0, x1) crop pairs measured via column-density analysis -- replaces
# the old REACTION_COUNT-based even division, which cut across a genuine empty
# gap partway through the sheet (not just touching poses) and produced
# misaligned/bled crops. y-range unchanged from the previous version.
REACTION_RECTS = [(20, 132), (132, 238), (238, 371), (371, 444), (478, 517), (517, 598), (598, 660)]
REACTION_Y = (35, 175)

# Original clean 7-frame walk cycle from the big multi-character sheet -- used
# as "idle" in an earlier version of this project, before being replaced by the
# user-supplied resting-pose sequence above. Reused here as "standing", the
# looping pose shown while the mouse hovers the dashboard.
STANDING_RECT = (6, 14, 205, 136)
STANDING_COUNT = 7


def slice_idle(im):
    y0, y1 = IDLE_Y
    return [im.crop((IDLE_BOUNDARIES[i], y0, IDLE_BOUNDARIES[i + 1], y1))
            for i in range(len(IDLE_BOUNDARIES) - 1)]


def slice_reaction(im):
    y0, y1 = REACTION_Y
    return [im.crop((x0, y0, x1, y1)) for (x0, x1) in REACTION_RECTS]


def slice_standing(im):
    x0, y0, x1, y1 = STANDING_RECT
    w = (x1 - x0) / STANDING_COUNT
    frames = []
    for i in range(STANDING_COUNT):
        fx0 = round(x0 + i * w)
        fx1 = round(x0 + (i + 1) * w)
        frames.append(im.crop((fx0, y0, fx1, y1)))
    return frames


def pad_to_common_canvas(frames):
    """Pad every frame (already chroma-keyed, RGBA) out to the sequence's max
    width/height with fully-transparent pixels, anchored at (0, 0) -- i.e. all
    padding lands on the right/bottom. This keeps each frame's existing (correct)
    crop alignment intact while giving every frame in the sequence identical
    canvas dimensions, so SpriteAnimator's fixed-size `.resizable()` frame
    stretches them all by the same factor instead of a per-frame one."""
    max_w = max(f.width for f in frames)
    max_h = max(f.height for f in frames)
    out = []
    for f in frames:
        canvas = Image.new("RGBA", (max_w, max_h), (0, 0, 0, 0))
        canvas.paste(f, (0, 0))
        out.append(canvas)
    return out


def process(name, src_path, slicer):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    # wipe any stale frames from a previous (possibly different frame-count) sequence
    for f in os.listdir(folder):
        if f.startswith("frame_") and f.endswith(".png"):
            os.remove(os.path.join(folder, f))

    sheet = Image.open(src_path).convert("RGB")
    raw_frames = slicer(sheet)
    sizes_before = [f.size for f in raw_frames]

    keyed = [chroma_key_transparent(f, bg_rgb=(255, 255, 255), tol=30) for f in raw_frames]
    padded = pad_to_common_canvas(keyed)

    for i, frame in enumerate(padded):
        upscaled = upscale_nearest(frame, UPSCALE)
        upscaled.save(os.path.join(folder, f"frame_{i:02d}.png"))

    sizes_after = [f.size for f in padded]
    print(f"{name}: wrote {len(padded)} frames, raw sizes={sizes_before}, canvas size={sizes_after[0]}")


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
    for (x0, x1) in REACTION_RECTS:
        draw.rectangle((x0, y0, x1, y1), outline=(255, 0, 0), width=2)
    draw.text((4, max(0, y0 - 14)), f"reaction ({len(REACTION_RECTS)})", fill=(255, 0, 0))
    panels.append(overview)

    standing_sheet = Image.open(STANDING_SRC).convert("RGB")
    overview = standing_sheet.copy()
    draw = ImageDraw.Draw(overview)
    x0, y0, x1, y1 = STANDING_RECT
    w = (x1 - x0) / STANDING_COUNT
    for i in range(STANDING_COUNT):
        fx0 = round(x0 + i * w)
        fx1 = round(x0 + (i + 1) * w)
        draw.rectangle((fx0, y0, fx1, y1), outline=(255, 0, 0), width=2)
    draw.text((4, max(0, y0 - 14)), f"standing ({STANDING_COUNT})", fill=(255, 0, 0))
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
    process("standing", STANDING_SRC, slice_standing)

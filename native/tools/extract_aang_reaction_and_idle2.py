# native/tools/extract_aang_reaction_and_idle2.py
# Replaces the old auto-cropped "idle" walk-cycle with a hand-picked resting-pose
# sheet, and adds a new one-shot "reaction" sequence (airbend attack) that plays
# once whenever a task gets ticked complete. See MascotModel/.reaction in main.swift.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

IDLE_SRC = os.path.expanduser("~/Downloads/aang_idle_resting.png")
REACTION_SRC = os.path.expanduser("~/Downloads/aang_reaction_airbend.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# name -> (source path, content bbox (x0,y0,x1,y1), frame_count)
# Both sheets have uniform poses evenly spaced across the measured content bbox
# (unlike earlier, messier sheets in this project where clusters had to be
# hand-boxed individually -- these two divide cleanly).
SEQUENCES = {
    "idle":     (IDLE_SRC,     (12, 24, 1118, 195), 8),
    "reaction": (REACTION_SRC, (20, 35, 661, 175), 7),
}


def slice_frames(im, rect, count):
    x0, y0, x1, y1 = rect
    w = (x1 - x0) / count
    frames = []
    for i in range(count):
        fx0 = round(x0 + i * w)
        fx1 = round(x0 + (i + 1) * w)
        frames.append(im.crop((fx0, y0, fx1, y1)))
    return frames


def content_bbox(rgba_frame):
    """Bounding box of non-transparent pixels, or None if frame is fully empty."""
    return rgba_frame.getbbox()


def process(name, src_path, rect, count):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    # wipe any stale frames from a previous (possibly different frame-count) sequence
    for f in os.listdir(folder):
        if f.startswith("frame_") and f.endswith(".png"):
            os.remove(os.path.join(folder, f))

    sheet = Image.open(src_path).convert("RGB")
    raw_frames = slice_frames(sheet, rect, count)
    keyed = [chroma_key_transparent(f, bg_rgb=(255, 255, 255), tol=30) for f in raw_frames]

    # crop each frame to its own content bbox, so per-sequence canvas sizing
    # below reflects actual drawn content, not incidental transparent padding
    cropped = []
    for k in keyed:
        bbox = content_bbox(k)
        cropped.append(k.crop(bbox) if bbox else k)

    canvas_w = max(c.width for c in cropped)
    canvas_h = max(c.height for c in cropped)

    for i, piece in enumerate(cropped):
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        ox = (canvas_w - piece.width) // 2
        oy = (canvas_h - piece.height) // 2
        canvas.paste(piece, (ox, oy), piece)
        canvas = upscale_nearest(canvas, UPSCALE)
        canvas.save(os.path.join(folder, f"frame_{i:02d}.png"))

    print(f"{name}: wrote {count} frames from {rect}, canvas={canvas_w}x{canvas_h} "
          f"(upscaled {canvas_w*UPSCALE}x{canvas_h*UPSCALE})")


def write_overview():
    """Draws a red box + label around every configured sequence's slice rect,
    on its own source sheet, for visual review (one overview image per sheet,
    stacked into a single _overview.png like the existing pattern)."""
    panels = []
    for name, (src_path, rect, count) in SEQUENCES.items():
        sheet = Image.open(src_path).convert("RGB")
        overview = sheet.copy()
        draw = ImageDraw.Draw(overview)
        x0, y0, x1, y1 = rect
        w = (x1 - x0) / count
        for i in range(count):
            fx0 = round(x0 + i * w)
            fx1 = round(x0 + (i + 1) * w)
            draw.rectangle((fx0, y0, fx1, y1), outline=(255, 0, 0), width=2)
        draw.rectangle(rect, outline=(0, 255, 0), width=2)
        draw.text((rect[0], max(0, rect[1] - 14)), f"{name} ({count})", fill=(255, 0, 0))
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
    for name, (src_path, rect, count) in SEQUENCES.items():
        process(name, src_path, rect, count)

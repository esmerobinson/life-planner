# native/tools/extract_aang_sprites.py
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

SRC = os.path.expanduser("~/Downloads/Avatar Aang Playable Characters.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# name -> (cluster rect (x0,y0,x1,y1), frame_count) -- sliced evenly across the rect's width
SEQUENCES = {
    "idle":   ((7, 828, 179, 868), 7),    # walk cycle, ~172px / 7 frames, h=40
    "splash": ((225, 599, 500, 753), 4),  # larger action cluster, ~275px / 4 frames, h=154
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

def process(name, rect, count, sheet):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for i, frame in enumerate(slice_frames(sheet, rect, count)):
        frame = chroma_key_transparent(frame, bg_rgb=(255, 255, 255), tol=30)
        frame = upscale_nearest(frame, UPSCALE)
        frame.save(os.path.join(folder, f"frame_{i:02d}.png"))
    print(f"{name}: wrote {count} frames from {rect}")

def write_overview(sheet):
    """Draws a red box + label around every configured sequence, for visual review."""
    overview = sheet.convert("RGB").copy()
    draw = ImageDraw.Draw(overview)
    for name, (rect, count) in SEQUENCES.items():
        draw.rectangle(rect, outline=(255, 0, 0), width=2)
        draw.text((rect[0], max(0, rect[1] - 14)), f"{name} ({count})", fill=(255, 0, 0))
    overview.save(os.path.join(OUT, "_overview.png"))

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.open(SRC).convert("RGB")
    write_overview(sheet)
    for name, (rect, count) in SEQUENCES.items():
        process(name, rect, count, sheet)

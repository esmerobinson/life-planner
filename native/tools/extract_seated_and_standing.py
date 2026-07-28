# native/tools/extract_seated_and_standing.py
# Replaces "idle" and "standing" with two new user-supplied 4-frame sheets:
#   - SEATED_SRC -> idle: mostly-still resting pose, occasional blink (existing
#     SpriteAnimator .idle logic already does "hold on frame 0, occasional full
#     bounce pass" -- these 4 frames are a subtle blink cycle, so that logic
#     reads as "blinks occasionally" unchanged).
#   - STANDING_SRC -> standing: a stand-up transition (frames 0-3), then
#     SpriteAnimator's .standing logic settles into bobbing between just the
#     last two frames once the transition finishes.
# Frames are NOT evenly spaced on either sheet (poses vary in width, and the
# staff bridges close to the next pose) -- even division cut into the body on
# a first pass (confirmed visually). Boundaries below are the real gaps,
# measured via column-density local minima, same method already used
# elsewhere in this project for its other non-uniform sheets.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import chroma_key_transparent, upscale_nearest
from PIL import Image

SEATED_SRC = os.path.expanduser("~/Desktop/Screenshot 2026-07-28 at 10.57.35.png")
STANDING_SRC = os.path.expanduser("~/Desktop/Screenshot 2026-07-28 at 10.57.41.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

SEATED_BOUNDARIES = [0, 286, 528, 770, 1022]
STANDING_BOUNDARIES = [0, 249, 448, 612, 786]


def slice_by_boundaries(im, boundaries):
    return [im.crop((boundaries[i], 0, boundaries[i + 1], im.height)) for i in range(len(boundaries) - 1)]


def pad_to_common_canvas(frames):
    max_w = max(f.width for f in frames)
    max_h = max(f.height for f in frames)
    out = []
    for f in frames:
        canvas = Image.new("RGBA", (max_w, max_h), (0, 0, 0, 0))
        canvas.paste(f, (0, 0))
        out.append(canvas)
    return out


def process(name, src_path, boundaries):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        os.remove(os.path.join(folder, f))

    sheet = Image.open(src_path).convert("RGB")
    frames = slice_by_boundaries(sheet, boundaries)
    frames = [chroma_key_transparent(f, bg_rgb=(255, 255, 255), tol=30) for f in frames]
    frames = pad_to_common_canvas(frames)
    for i, frame in enumerate(frames):
        upscale_nearest(frame, UPSCALE).save(os.path.join(folder, f"frame_{i:02d}.png"))
    print(f"{name}: wrote {len(frames)} frames from {src_path}, canvas size={frames[0].size}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    process("idle", SEATED_SRC, SEATED_BOUNDARIES)
    process("standing", STANDING_SRC, STANDING_BOUNDARIES)

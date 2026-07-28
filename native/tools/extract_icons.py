# native/tools/extract_icons.py
import sys
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent, recolor_lineart
from PIL import Image
import os

SYMBOLS = os.path.expanduser("~/Downloads/symbols_avatar.jpg")
LOTUS = os.path.expanduser("~/Downloads/lotustileavatar.jpg")
OUT = "native/Assets/Icons"

# (name, rect, recolor target RGB matching the theming palette)
ELEMENTS = [
    ("air",   (336, 1245, 484, 1398), (0x3D, 0x7A, 0x66)),  # blue-green teal, clearly distinct hue from water
    ("water", (327,  658, 484,  811), (0x1E, 0x6F, 0xC7)),  # deeper saturated blue #1E6FC7
    ("fire",  (320, 1023, 494, 1218), (0xEE, 0x72, 0x23)),  # orange #EE7223
    ("earth", (321,  837, 490, 1003), (0x71, 0x54, 0x47)),  # brown #715447
]
LOTUS_RECT = (215, 37, 535, 357)
LOTUS_COLOR = (0x6E, 0x17, 0x00)  # dark red-brown #6E1700

def process(src_path, rect, color, out_name, canvas=128):
    im = Image.open(src_path).convert("RGB")
    piece = crop(im, rect)
    piece = recolor_lineart(piece, color, dark_thresh=140)
    piece = chroma_key_transparent(piece, bg_rgb=(255, 255, 255), tol=40)
    # letterbox onto a fixed square canvas, preserving aspect ratio
    piece.thumbnail((canvas, canvas), Image.LANCZOS)
    square = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ox = (canvas - piece.width) // 2
    oy = (canvas - piece.height) // 2
    square.paste(piece, (ox, oy), piece)
    square.save(os.path.join(OUT, f"{out_name}.png"))
    print(f"wrote {out_name}.png from {rect}")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, rect, color in ELEMENTS:
        process(SYMBOLS, rect, color, name)
    process(LOTUS, LOTUS_RECT, LOTUS_COLOR, "lotus")

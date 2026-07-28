# native/tools/extract_border.py
# Crops the ornate blue bordered-frame graphic used as a 9-slice-able background
# for the "make a journal entry now?" CTA button. Source sheet has a solid green
# chroma-key background (0,119,0) around the frame art, same convention as the
# other extraction scripts in this folder.
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent
from PIL import Image

SRC = "docs/superpowers/fontsavatar.png"
OUT = "native/Assets/Border"
# real, controller-measured pixel bounds of the frame graphic
FRAME_RECT = (3, 409, 210, 552)
GREEN_BG = (0, 119, 0)

def process():
    im = Image.open(SRC).convert("RGB")
    piece = crop(im, FRAME_RECT)
    piece = chroma_key_transparent(piece, bg_rgb=GREEN_BG, tol=40)
    os.makedirs(OUT, exist_ok=True)
    out_path = os.path.join(OUT, "frame.png")
    piece.save(out_path)
    print(f"wrote {out_path} ({piece.width}x{piece.height}) from {FRAME_RECT}")

if __name__ == "__main__":
    process()

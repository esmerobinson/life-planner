"""Shared helpers for turning ripped ATLA asset sheets into transparent PNGs.
Output always goes under native/Assets/ (gitignored) -- see Task 1."""

from PIL import Image
import numpy as np

def crop(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return im.crop(box)

def chroma_key_transparent(im: Image.Image, bg_rgb=(255, 255, 255), tol=20) -> Image.Image:
    """Turn near-bg_rgb pixels fully transparent. tol is per-channel Manhattan tolerance."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    diff = np.abs(arr[:, :, :3].astype(int) - np.array(bg_rgb)).sum(axis=2)
    arr[:, :, 3] = np.where(diff <= tol, 0, arr[:, :, 3])
    return Image.fromarray(arr, "RGBA")

def upscale_nearest(im: Image.Image, factor: int) -> Image.Image:
    w, h = im.size
    return im.resize((w * factor, h * factor), Image.NEAREST)

def recolor_lineart(im: Image.Image, target_rgb: tuple[int, int, int], dark_thresh=100) -> Image.Image:
    """Replace dark line-art pixels with target_rgb, keeping existing alpha untouched."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    is_dark = arr[:, :, :3].astype(int).sum(axis=2) < dark_thresh * 3
    arr[:, :, 0] = np.where(is_dark, target_rgb[0], arr[:, :, 0])
    arr[:, :, 1] = np.where(is_dark, target_rgb[1], arr[:, :, 1])
    arr[:, :, 2] = np.where(is_dark, target_rgb[2], arr[:, :, 2])
    return Image.fromarray(arr, "RGBA")

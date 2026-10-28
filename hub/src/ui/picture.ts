// Pictures for pages (round 3b): downscaled in the browser before they are stored, so a
// picture row stays well under the sync server's 1 MB row cap.

/** Longest side after downscaling (pixels). */
export const PICTURE_MAX_SIDE = 1600;
/** JPEG quality tried first; lowered in steps (then the size) until the picture fits. */
export const PICTURE_QUALITY = 0.8;
export const PICTURE_QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4] as const;
/** A stored picture is always under this many bytes of JPEG (about 933,000 base64 characters). */
export const PICTURE_MAX_BYTES = 700_000;
/** Each further step shrinks both sides by this factor. */
const SHRINK = 0.75;
/** Below this long side, a picture that still does not fit is refused. */
const MIN_SIDE = 64;

export const PICTURE_UNREADABLE = "That picture could not be added. Try a JPEG or PNG photo.";

/** Encodes the source at a size and quality; returns the encoded bytes. */
export type Encode = (width: number, height: number, quality: number) => Promise<Blob>;

/**
 * The size rule on its own (testable without a canvas): at most PICTURE_MAX_SIDE on the long
 * side, JPEG quality 0.8, then lower quality, then smaller, until it is under
 * PICTURE_MAX_BYTES.
 */
export async function fitPicture(
  natural: { width: number; height: number },
  encode: Encode,
): Promise<{ blob: Blob; width: number; height: number; quality: number }> {
  const long = Math.max(natural.width, natural.height);
  if (!(long > 0)) throw new Error(PICTURE_UNREADABLE);
  let scale = Math.min(1, PICTURE_MAX_SIDE / long);
  for (;;) {
    const width = Math.max(1, Math.round(natural.width * scale));
    const height = Math.max(1, Math.round(natural.height * scale));
    for (const quality of PICTURE_QUALITIES) {
      const blob = await encode(width, height, quality);
      if (blob.size < PICTURE_MAX_BYTES) return { blob, width, height, quality };
    }
    if (Math.max(width, height) <= MIN_SIDE) throw new Error(PICTURE_UNREADABLE);
    scale *= SHRINK;
  }
}

/** Base64 of a blob's bytes (no `data:` prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decodes an image file (the browser applies its camera orientation when drawing). */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(PICTURE_UNREADABLE));
    };
    img.src = url;
  });
}

/** A chosen photo, downscaled and re-encoded as JPEG, ready for `addPicture`. */
export async function downscalePicture(
  file: Blob,
): Promise<{ mime: "image/jpeg"; data: string; width: number; height: number }> {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(PICTURE_UNREADABLE);
  const encode: Encode = (width, height, quality) => {
    canvas.width = width;
    canvas.height = height;
    // JPEG has no transparency: transparent parts of a PNG become white, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(PICTURE_UNREADABLE))), "image/jpeg", quality),
    );
  };
  const fitted = await fitPicture({ width: img.naturalWidth, height: img.naturalHeight }, encode);
  canvas.width = 0; // let the browser free the bitmap now
  canvas.height = 0;
  return { mime: "image/jpeg", data: await blobToBase64(fitted.blob), width: fitted.width, height: fitted.height };
}

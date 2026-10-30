// QR codes for pairing, using `qr` (paulmillr/qr, MIT OR Apache-2.0, zero dependencies,
// pinned exactly in package.json). Encoding is small and bundled; the decoder is loaded only
// when the camera is opened.

import encodeQR from "qr";

/** The QR standard's quiet zone, in modules. */
export const QUIET_ZONE = 4;

/**
 * Dark/light modules of the code for `text`, quiet zone included (light modules all round).
 * Medium error correction: a phone held at an angle to a Mac screen still reads it.
 */
export function qrModules(text: string): boolean[][] {
  return encodeQR(text, "raw", { ecc: "medium", border: QUIET_ZONE });
}

/** One SVG path drawing every dark module as a 1x1 square (module coordinates). */
export function qrPath(modules: boolean[][]): string {
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return d;
}

type Decode = (img: { width: number; height: number; data: Uint8ClampedArray }) => string;
let decoder: Promise<Decode> | null = null;

/** Loads the decoder (a separate chunk) once. */
export function loadDecoder(): Promise<Decode> {
  decoder ??= import("qr/decode.js").then(
    (m) => m.decodeQR as Decode,
    (e: unknown) => {
      decoder = null; // a later Scan tries to load it again
      throw e;
    },
  );
  return decoder;
}

let canvas: HTMLCanvasElement | null = null;
/** Longest side a frame is scaled to before decoding (enough for a code filling part of the view). */
const MAX_SIDE = 720;

/**
 * Reads one camera frame: the decoded text, or null when no code is in it (or the video has no
 * frame yet). Never throws for a frame miss.
 */
export async function readFrame(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const decode = await loadDecoder();
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  canvas ??= document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  try {
    return decode({ width, height, data: img.data });
  } catch {
    return null; // no code in this frame
  } finally {
    ctx.clearRect(0, 0, width, height); // the frame (maybe showing the code) is not kept
  }
}

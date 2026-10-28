import { describe, expect, it } from "vitest";
import { blobToBase64, fitPicture, PICTURE_MAX_BYTES, PICTURE_MAX_SIDE, type Encode } from "./picture";

// The size rule. The real canvas encoding runs in the browser (e2e/round-3b.spec.ts feeds a
// generated large noisy image through the Picture button and checks the stored row).

/** A fake JPEG encoder: bytes grow with pixels and quality (noise-like when `perPixel` is high). */
const fakeEncoder = (perPixel: number) => {
  const calls: [number, number, number][] = [];
  const encode: Encode = async (w, h, q) => {
    calls.push([w, h, q]);
    return new Blob([new Uint8Array(Math.round(w * h * perPixel * q))]);
  };
  return { encode, calls };
};

describe("fitPicture", () => {
  it("an ordinary photo is scaled to 1600px on the long side at quality 0.8", async () => {
    const { encode, calls } = fakeEncoder(0.3);
    const r = await fitPicture({ width: 4032, height: 3024 }, encode);
    expect([r.width, r.height, r.quality]).toEqual([1600, 1200, 0.8]);
    expect(calls).toHaveLength(1);
    expect(r.blob.size).toBeLessThan(PICTURE_MAX_BYTES);
  });

  it("a small picture is never enlarged", async () => {
    const { encode } = fakeEncoder(0.3);
    const r = await fitPicture({ width: 640, height: 480 }, encode);
    expect([r.width, r.height]).toEqual([640, 480]);
  });

  it("a heavy picture gets lower quality, then smaller, until it is under 700 KB", async () => {
    const { encode, calls } = fakeEncoder(3); // like noise: barely compresses
    const r = await fitPicture({ width: 3000, height: 4000 }, encode);
    expect(r.blob.size).toBeLessThan(PICTURE_MAX_BYTES);
    expect(Math.max(r.width, r.height)).toBeLessThan(PICTURE_MAX_SIDE);
    expect(r.height).toBeGreaterThan(r.width); // the shape is kept
    // Every quality step is tried at full size before shrinking.
    expect(calls.slice(0, 5).map((c) => c[2])).toEqual([0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(calls.slice(0, 5).every((c) => c[0] === 1200 && c[1] === 1600)).toBe(true);
  });

  it("a picture that never fits is refused instead of looping", async () => {
    const encode: Encode = async () => new Blob([new Uint8Array(PICTURE_MAX_BYTES)]);
    await expect(fitPicture({ width: 2000, height: 2000 }, encode)).rejects.toThrow(/could not be added/);
    await expect(fitPicture({ width: 0, height: 0 }, encode)).rejects.toThrow(/could not be added/);
  });
});

describe("blobToBase64", () => {
  it("encodes the bytes exactly (also past one chunk)", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const b64 = await blobToBase64(new Blob([bytes]));
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});

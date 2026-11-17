import { outlineRings } from "./outline";

/** A w x h RGBA picture, opaque where `on` says. */
function picture(w: number, h: number, on: (x: number, y: number) => boolean): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) d[(y * w + x) * 4 + 3] = 255;
  return d;
}
const pairs = (a: number[]) => Array.from({ length: a.length / 2 }, (_, i) => `${a[2 * i]},${a[2 * i + 1]}`).sort();

describe("outlineRings: the map's open-place line, one pixel of cream round the art and one of ink round that", () => {
  it("a single opaque pixel: the cream ring is its four neighbours, the ink ring the ones round those", () => {
    const d = picture(7, 7, (x, y) => x === 3 && y === 3);
    const r = outlineRings(d, 7, 7, [3, 3, 1, 1]);
    expect(pairs(r.inner)).toEqual(["2,3", "3,2", "3,4", "4,3"]);
    expect(pairs(r.outer)).toEqual(["1,3", "2,2", "2,4", "3,1", "3,5", "4,2", "4,4", "5,3"]);
  });

  it("stays inside the picture, and ignores art outside the place's box grown by two", () => {
    const d = picture(5, 5, (x, y) => (x === 0 && y === 0) || (x === 4 && y === 4));
    const r = outlineRings(d, 5, 5, [0, 0, 1, 1]);
    expect(pairs(r.inner)).toEqual(["0,1", "1,0"]);
    expect(r.outer.every((n) => n >= 0 && n < 5)).toBe(true);
    expect(pairs(r.inner)).not.toContain("3,4");
  });

  it("nothing opaque, no line", () => {
    const r = outlineRings(picture(4, 4, () => false), 4, 4, [0, 0, 4, 4]);
    expect(r.inner).toEqual([]);
    expect(r.outer).toEqual([]);
  });
});

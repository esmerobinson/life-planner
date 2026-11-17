import { RIO_MAP } from "./assets";
import { MAP_KEEP, coverFit, fitScale, hitPlace, doorKeep, sceneKeep, stickerBox } from "./mapMath";

const CANVAS: [number, number] = [896, 504];

describe("fitScale: the whole map fits, at the largest crisp size", () => {
  it("a whole number of device pixels per art pixel", () => {
    expect(fitScale({ w: 1440, h: 820 }, CANVAS, 2)).toBe(1.5); // 3 device px
    expect(fitScale({ w: 900, h: 520 }, CANVAS, 1)).toBe(1);
    expect(fitScale({ w: 1800, h: 1100 }, CANVAS, 1)).toBe(2);
    expect(fitScale({ w: 2000, h: 600 }, CANVAS, 1)).toBe(1); // the height decides
  });

  it("below one device pixel only as a last resort, at the largest whole fraction that fits (review focus 5)", () => {
    // 380 css px at 2x: 1 device px per art px would be 448 css px wide, which doesn't fit.
    expect(fitScale({ w: 380, h: 700 }, CANVAS, 2)).toBe(0.25);
    expect(fitScale({ w: 380, h: 700 }, CANVAS, 1)).toBeCloseTo(1 / 3);
    expect(fitScale({ w: 1000, h: 200 }, CANVAS, 1)).toBeCloseTo(1 / 3); // a very short window
  });

  it("whatever the window, the map fits it", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const [w, h] of [[320, 480], [390, 844], [768, 1024], [1280, 720], [1440, 900], [2560, 1440], [1000, 150]]) {
        const s = fitScale({ w: w!, h: h! }, CANVAS, dpr);
        expect(896 * s, `${w}x${h}@${dpr}`).toBeLessThanOrEqual(w! + 1e-9);
        expect(504 * s, `${w}x${h}@${dpr}`).toBeLessThanOrEqual(h! + 1e-9);
        const device = s * dpr;
        expect(device >= 1 ? Number.isInteger(Math.round(device * 1e9) / 1e9) : Number.isInteger(Math.round((1 / device) * 1e9) / 1e9)).toBe(true);
      }
    }
  });
});

describe("hitPlace", () => {
  const centre = (key: string): [number, number] => {
    const [x, y, w, h] = RIO_MAP.places.find((p) => p.key === key)!.hotspot.rect;
    return [x + w / 2, y + h / 2];
  };
  it("finds the place under a point", () => {
    expect(hitPlace(...centre("lagoa-house"))).toBe("lagoa-house");
    expect(hitPlace(...centre("barraca"))).toBe("barraca");
  });
  it("the inset and the boat route open the fazenda", () => {
    const [x, y, w, h] = RIO_MAP.inset.rect;
    expect(hitPlace(x + w / 2, y + h / 2)).toBe("fazenda");
    const [bx, by, bw, bh] = RIO_MAP.boat_route.hotspot.rect;
    expect(hitPlace(bx + bw / 2, by + bh / 2)).toBe("fazenda");
  });
  it("nothing at the corner of the map", () => {
    expect(hitPlace(0, 0)).toBeNull();
  });
});

describe("today's map art (re-imported 2026-11-17: bigger landmarks, new Sult, Quilo, Os Esquilos)", () => {
  const PLACES = new Map(RIO_MAP.places.map((p) => [p.key, p]));
  it.each(["christ-the-redeemer", "flamengo-match", "sult", "quilo", "os-esquilos"])("a tap in the middle of %s's hotspot opens it", (key) => {
    const p = PLACES.get(key)!;
    const [x, y] = p.hotspot.polygon.reduce(([sx, sy], [px, py]) => [sx + px / p.hotspot.polygon.length, sy + py / p.hotspot.polygon.length], [0, 0]);
    expect(hitPlace(x, y)).toBe(key);
  });
  it("every marker and tooltip anchor sits on its own place (within its bbox, the marker at most at its top edge)", () => {
    for (const p of RIO_MAP.places) {
      const [bx, by, bw, bh] = p.bbox;
      for (const [ax, ay] of [p.marker_anchor, p.tooltip_anchor]) {
        expect(ax, p.key).toBeGreaterThanOrEqual(bx);
        expect(ax, p.key).toBeLessThanOrEqual(bx + bw);
        expect(ay, p.key).toBeGreaterThanOrEqual(by - 4);
        expect(ay, p.key).toBeLessThanOrEqual(by + bh);
      }
    }
  });
});

describe("coverFit: an even border, never trimming what matters (Esme, 2026-11-17)", () => {
  const CANVAS = RIO_MAP.canvas;
  const inside = (outer: number, a: number, b: number) => a >= -1e-6 && b <= outer + 1e-6;

  it("the map's keep region holds every place's hotspot and bbox and the Ilha Grande inset", () => {
    const [kx, ky, kw, kh] = MAP_KEEP;
    for (const p of RIO_MAP.places) {
      for (const [x, y, w, h] of [p.bbox, p.hotspot.rect]) {
        expect(x).toBeGreaterThanOrEqual(kx);
        expect(y).toBeGreaterThanOrEqual(ky);
        expect(x + w).toBeLessThanOrEqual(kx + kw);
        expect(y + h).toBeLessThanOrEqual(ky + kh);
      }
    }
    const [ix, iy, iw, ih] = RIO_MAP.inset.frame_rect;
    expect(ix + iw).toBeLessThanOrEqual(kx + kw);
    expect(iy + ih).toBeLessThanOrEqual(ky + kh);
  });

  it("a view shaped like the keep region: the map covers it, trimming only outside it", () => {
    const [, , kw, kh] = MAP_KEEP;
    const f = coverFit({ w: kw * 2, h: kh * 2 }, CANVAS, MAP_KEEP, 1);
    expect(f).toMatchObject({ mode: "cover", scale: 2 });
  });

  it("very wide (2560x1080), very tall (390x844) and 1440x900 windows: whatever the mode, nothing that matters is cut", () => {
    for (const [w, h, dpr] of [[2512, 1032, 1], [374, 828, 3], [1392, 852, 2], [1754, 996, 1]] as const) {
      const f = coverFit({ w, h }, CANVAS, MAP_KEEP, dpr);
      const [kx, ky, kw, kh] = MAP_KEEP;
      expect(inside(w, f.x + kx * f.scale, f.x + (kx + kw) * f.scale)).toBe(true);
      expect(inside(h, f.y + ky * f.scale, f.y + (ky + kh) * f.scale)).toBe(true);
      expect(Math.abs(f.scale * dpr - Math.round(f.scale * dpr)) < 1e-9 || Math.abs(1 / (f.scale * dpr) - Math.round(1 / (f.scale * dpr))) < 1e-9).toBe(true);
    }
  });

  it("over a sweep of sizes: cover means the art covers the view with the keep region inside; fit means the whole art is inside", () => {
    for (let w = 300; w <= 2600; w += 37) {
      for (let h = 300; h <= 1500; h += 41) {
        for (const dpr of [1, 2, 3]) {
          const f = coverFit({ w, h }, CANVAS, MAP_KEEP, dpr);
          const aw = CANVAS[0] * f.scale;
          const ah = CANVAS[1] * f.scale;
          if (f.mode === "cover") {
            expect(f.x).toBeLessThanOrEqual(1e-6);
            expect(f.y).toBeLessThanOrEqual(1e-6);
            expect(f.x + aw).toBeGreaterThanOrEqual(w - 1e-6);
            expect(f.y + ah).toBeGreaterThanOrEqual(h - 1e-6);
            const [kx, ky, kw, kh] = MAP_KEEP;
            expect(inside(w, f.x + kx * f.scale, f.x + (kx + kw) * f.scale)).toBe(true);
            expect(inside(h, f.y + ky * f.scale, f.y + (ky + kh) * f.scale)).toBe(true);
          } else {
            expect(f.scale).toBe(fitScale({ w, h }, CANVAS, dpr));
            expect(inside(w, f.x, f.x + aw)).toBe(true);
            expect(inside(h, f.y, f.y + ah)).toBe(true);
          }
          // Whole device pixels for the offsets too (crisp).
          expect(Math.abs(f.x * dpr - Math.round(f.x * dpr))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("a scene's keep region is what's drawn there: its stickers and the middle of each door", () => {
    const k = sceneKeep([stickerBox({ x: 40, y: 60 }), stickerBox({ x: 100, y: 30 })], [320, 180]);
    expect(k).toEqual([32, 14, 76, 46]);
    // A strip-wide exit only keeps its middle (it can't stop the scene covering the view).
    expect(doorKeep([0, 200, 384, 40])).toEqual([180, 208, 24, 24]);
    expect(doorKeep([196, 96, 10, 54])).toEqual([196, 111, 10, 24]);
    // Nothing drawn: the middle of the scene.
    expect(sceneKeep([], [320, 180])).toEqual([160, 90, 0, 0]);
    // Kept to the art.
    expect(sceneKeep([stickerBox({ x: 2, y: 4 })], [320, 180])).toEqual([0, 0, 10, 4]);
  });
});

describe("coverFit, fractional (desktop; Esme 2026-11-17: \"a bit bigger and borders a bit smaller\")", () => {
  const CANVAS = RIO_MAP.canvas;
  /** The view inside the plank border: the window less 4 UI px a side at the desktop's 3x. */
  const view = (w: number, h: number) => ({ w: w - 24, h: h - 24 });

  it.each([[1440, 900], [1280, 800], [2560, 1080]])("%ix%i: the largest scale where every place still fits, filling the view in at least one direction", (W, H) => {
    const box = view(W, H);
    const f = coverFit(box, CANVAS, MAP_KEEP, 2, true);
    const [kx, ky, kw, kh] = MAP_KEEP;
    // Nothing that matters is cut.
    expect(f.x + kx * f.scale).toBeGreaterThanOrEqual(-1e-6);
    expect(f.y + ky * f.scale).toBeGreaterThanOrEqual(-1e-6);
    expect(f.x + (kx + kw) * f.scale).toBeLessThanOrEqual(box.w + 1e-6);
    expect(f.y + (ky + kh) * f.scale).toBeLessThanOrEqual(box.h + 1e-6);
    // As big as that allows: the protected area touches the view on one side, or the art covers it all.
    const cover = Math.max(box.w / CANVAS[0], box.h / CANVAS[1]);
    expect(f.scale).toBeCloseTo(Math.min(cover, box.w / kw, box.h / kh), 9);
    // It fills the view edge to edge in at least one direction (the border stays the small one there).
    const aw = CANVAS[0] * f.scale;
    const ah = CANVAS[1] * f.scale;
    expect(aw >= box.w - 1e-6 || ah >= box.h - 1e-6).toBe(true);
    // Bigger than the crisp fit it replaces.
    expect(f.scale).toBeGreaterThanOrEqual(fitScale(box, CANVAS, 2));
  });

  it("a small protected area never zooms past the scale that fills the view", () => {
    const f = coverFit({ w: 1000, h: 600 }, [320, 180], [150, 80, 16, 16], 2, true);
    expect(f.scale).toBeCloseTo(Math.max(1000 / 320, 600 / 180), 9);
    expect(f.mode).toBe("cover");
  });

  // Esme, 2026-11-17 ("store appearing like this, same with zona sul not full screen"): a protected
  // area smaller than the view left planks below and to the right (its bounds were swapped).
  it.each([[[150, 110, 60, 40]], [[10, 10, 30, 30]], [[300, 190, 60, 40]]] as const)(
    "a scene covers the view whole, its protected area %j inside", (keep) => {
      const box = { w: 1416, h: 876 };
      const f = coverFit(box, [384, 240], [...keep], 1, true);
      expect(f.mode).toBe("cover");
      expect(f.x).toBeLessThanOrEqual(1e-6);
      expect(f.y).toBeLessThanOrEqual(1e-6);
      expect(f.x + 384 * f.scale).toBeGreaterThanOrEqual(box.w - 1e-6);
      expect(f.y + 240 * f.scale).toBeGreaterThanOrEqual(box.h - 1e-6);
      const [kx, ky, kw, kh] = keep;
      expect(f.x + kx * f.scale).toBeGreaterThanOrEqual(-1e-6);
      expect(f.y + ky * f.scale).toBeGreaterThanOrEqual(-1e-6);
      expect(f.x + (kx + kw) * f.scale).toBeLessThanOrEqual(box.w + 1e-6);
      expect(f.y + (ky + kh) * f.scale).toBeLessThanOrEqual(box.h + 1e-6);
    });

  it("the phone's crisp cover keeps a small protected area inside too", () => {
    const f = coverFit({ w: 375, h: 600 }, [384, 240], [300, 190, 40, 40], 2);
    const [kx, ky, kw, kh] = [300, 190, 40, 40];
    expect(f.x + kx * f.scale).toBeGreaterThanOrEqual(-1e-6);
    expect(f.x + (kx + kw) * f.scale).toBeLessThanOrEqual(375 + 1e-6);
    expect(f.y + ky * f.scale).toBeGreaterThanOrEqual(-1e-6);
    expect(f.y + (ky + kh) * f.scale).toBeLessThanOrEqual(600 + 1e-6);
  });

  it("an empty box or protected area doesn't break it", () => {
    expect(Number.isFinite(coverFit({ w: 0, h: 0 }, CANVAS, MAP_KEEP, 2, true).scale)).toBe(true);
    expect(Number.isFinite(coverFit({ w: 800, h: 600 }, CANVAS, [10, 10, 0, 0], 2, true).x)).toBe(true);
  });
});

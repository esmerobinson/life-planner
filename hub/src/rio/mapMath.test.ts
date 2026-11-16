import { RIO_MAP } from "./assets";
import { fitScale, hitPlace } from "./mapMath";

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

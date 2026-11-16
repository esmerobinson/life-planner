// Esme's Rio: the map's sums. The whole map always fits the window, at the largest crisp size
// (Esme, 2026-11-14: "i dont wanna have to scroll"): a whole number of device pixels per art
// pixel; only if even one doesn't fit, the largest whole fraction (1/2, 1/3…) that does.

import { RIO_MAP } from "./assets";

const EPS = 1e-9;

/** The CSS scale for the canvas in `box` (CSS px) at this device pixel ratio. */
export function fitScale(box: { w: number; h: number }, canvas: [number, number], dpr: number): number {
  const d = dpr > 0 ? dpr : 1;
  const room = Math.min((box.w * d) / canvas[0], (box.h * d) / canvas[1]);
  if (!(room > 0)) return 1 / d;
  const n = Math.floor(room + EPS);
  if (n >= 1) return n / d;
  const m = Math.ceil(1 / room - EPS);
  return 1 / (m * d);
}

/** Point in polygon (even-odd), in map pixels. */
export function inPolygon(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inRect = (x: number, y: number, [rx, ry, rw, rh]: readonly number[]) => x >= rx! && y >= ry! && x < rx! + rw! && y < ry! + rh!;
const PLACE = new Map(RIO_MAP.places.map((p) => [p.key, p]));

/** The place under a map pixel (smallest first, as map.json says), the boat route and inset opening the fazenda. */
export function hitPlace(x: number, y: number): string | null {
  for (const key of RIO_MAP.hit_test_order) {
    const p = PLACE.get(key);
    if (p && inPolygon(x, y, p.hotspot.polygon)) return key;
  }
  if (inPolygon(x, y, RIO_MAP.boat_route.hotspot.polygon)) return RIO_MAP.boat_route.links;
  if (inRect(x, y, RIO_MAP.inset.rect)) return RIO_MAP.inset.key;
  return null;
}

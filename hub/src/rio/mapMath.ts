// Esme's Rio: the map's sums. Always at a crisp size (Esme, 2026-11-14: "i dont wanna have to
// scroll"): a whole number of device pixels per art pixel; only if even one doesn't fit, the
// largest whole fraction (1/2, 1/3…) that does. In the full-screen game (2026-11-17: "truly
// full screen with a small border though not just at top and bottom") the art covers the view
// so the plank border is even, trimming only what doesn't matter (coverFit).

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

type Rect = [number, number, number, number];

/** The union of rectangles (x, y, w, h). */
function union(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Clipped to the art. */
function within([x, y, w, h]: Rect, [cw, ch]: [number, number]): Rect {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  return [x0, y0, Math.min(cw, x + w) - x0, Math.min(ch, y + h) - y0];
}

/** Marker art stands on its anchor (bottom-centre): room for it above. */
const MARKER_ROOM = 16;

/**
 * What the map may never trim: every place's hotspot and bbox, its marker above its anchor, and
 * the Ilha Grande inset's frame.
 */
export const MAP_KEEP: Rect = within(
  union([
    ...RIO_MAP.places.flatMap((p): Rect[] => [
      p.bbox, p.hotspot.rect, [p.marker_anchor[0] - MARKER_ROOM / 2, p.marker_anchor[1] - MARKER_ROOM, MARKER_ROOM, MARKER_ROOM],
    ]),
    RIO_MAP.inset.frame_rect,
  ]),
  RIO_MAP.canvas,
);

/** What an area scene may never trim: its sticker slots, a 16x16 sticker on each (the whole scene if none). */
export function sceneKeep(slots: readonly { x: number; y: number; anchor?: string }[], scene: [number, number]): Rect {
  if (slots.length === 0) return [0, 0, scene[0], scene[1]];
  return within(union(slots.map((s): Rect => [s.x - 8, s.anchor === "top" ? s.y : s.y - 16, 16, 16])), scene);
}

export interface Cover { scale: number; x: number; y: number; mode: "cover" | "fit" }

/**
 * Where the art sits in a view `box` (CSS px): at the largest crisp scale at which `keep` fits,
 * if the art then covers the view ("cover": the border stays even; centred on `keep`, kept to
 * the art's edges, `keep` whole). Otherwise the whole art fits, centred ("fit": uneven border).
 * Offsets land on whole device pixels.
 */
export function coverFit(box: { w: number; h: number }, canvas: [number, number], keep: Rect, dpr: number): Cover {
  const d = dpr > 0 ? dpr : 1;
  const [kx, ky, kw, kh] = keep;
  const s = fitScale(box, [kw, kh], d);
  const aw = canvas[0] * s;
  const ah = canvas[1] * s;
  if (box.w > 0 && box.h > 0 && aw >= box.w - EPS && ah >= box.h - EPS) {
    // The offsets that keep the art covering the view and `keep` inside it, on the device grid.
    const place = (view: number, art: number, k0: number, k1: number): number | null => {
      const lo = Math.ceil(Math.max(view - art, view - k1 * s) * d - EPS) / d;
      const hi = Math.floor(Math.min(0, -k0 * s) * d + EPS) / d;
      if (lo > hi) return null;
      const centred = Math.round((view / 2 - ((k0 + k1) / 2) * s) * d) / d;
      return Math.min(hi, Math.max(lo, centred));
    };
    const x = place(box.w, aw, kx, kx + kw);
    const y = place(box.h, ah, ky, ky + kh);
    if (x !== null && y !== null) return { scale: s, x, y, mode: "cover" };
  }
  const f = fitScale(box, canvas, d);
  return {
    scale: f,
    x: Math.max(0, Math.floor(((box.w - canvas[0] * f) / 2) * d) / d),
    y: Math.max(0, Math.floor(((box.h - canvas[1] * f) / 2) * d) / d),
    mode: "fit",
  };
}

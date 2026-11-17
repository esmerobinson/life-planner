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

/** The 16x16 box of a sticker standing on a slot (foot point bottom-centre, or top-centre). */
export const stickerBox = (s: { x: number; y: number; anchor?: string }): Rect => [s.x - 8, s.anchor === "top" ? s.y : s.y - 16, 16, 16];

/** The part of a door that must stay on screen: its middle, at most 24x24 (a strip-wide exit can't stop a scene covering the view). */
export function doorKeep([x, y, w, h]: Rect): Rect {
  const kw = Math.min(w, 24);
  const kh = Math.min(h, 24);
  return [x + Math.floor((w - kw) / 2), y + Math.floor((h - kh) / 2), kw, kh];
}

/**
 * What an area scene may never trim (Esme, 2026-11-17: every scene fills the game screen, nothing
 * that matters cut): what is drawn there, its placed stickers' boxes and its doors' middles (free
 * slots hold nothing). Nothing at all: the scene's middle, so it simply covers the view centred.
 */
export function sceneKeep(boxes: readonly Rect[], scene: [number, number]): Rect {
  if (boxes.length === 0) return [scene[0] / 2, scene[1] / 2, 0, 0];
  return within(union(boxes), scene);
}

export interface Cover { scale: number; x: number; y: number; mode: "cover" | "fit" }

/**
 * Fractional (the desktop; Esme, 2026-11-17: "maybe just make it a bit bigger and borders a bit
 * smaller"): the scale at which the art just covers the view, if `keep` still fits there (an even
 * border); else the largest at which `keep` fits, so the art fills the view one way and the
 * spare room the other way is planks. Never larger than covering needs. Drawn nearest-neighbour.
 */
function fractionalFit(box: { w: number; h: number }, canvas: [number, number], keep: Rect, d: number): Cover {
  const [kx, ky, kw, kh] = keep;
  if (!(box.w > 0 && box.h > 0)) return { scale: 1, x: 0, y: 0, mode: "fit" };
  const covering = Math.max(box.w / canvas[0], box.h / canvas[1]);
  const keepFits = Math.min(kw > 0 ? box.w / kw : Infinity, kh > 0 ? box.h / kh : Infinity);
  const s = Math.min(covering, keepFits);
  const aw = canvas[0] * s;
  const ah = canvas[1] * s;
  const place = (view: number, art: number, k0: number, k1: number): number => {
    if (art < view) return Math.round(((view - art) / 2) * d) / d; // the whole art, centred
    // Covering the view (offset <= 0, offset + art >= view) with `keep` inside it
    // (offset + k0 s >= 0, offset + k1 s <= view).
    const lo = Math.max(view - art, -k0 * s);
    const hi = Math.min(0, view - k1 * s);
    const centred = Math.round((view / 2 - ((k0 + k1) / 2) * s) * d) / d;
    return Math.min(hi, Math.max(lo, centred));
  };
  const x = place(box.w, aw, kx, kx + kw);
  const y = place(box.h, ah, ky, ky + kh);
  return { scale: s, x, y, mode: aw >= box.w - EPS && ah >= box.h - EPS ? "cover" : "fit" };
}

/**
 * Where the art sits in a view `box` (CSS px). `fractional` (the desktop): fractionalFit. Else
 * (the phone, unchanged): at the largest crisp scale at which `keep` fits,
 * if the art then covers the view ("cover": the border stays even; centred on `keep`, kept to
 * the art's edges, `keep` whole). Otherwise the whole art fits, centred ("fit": uneven border).
 * Offsets land on whole device pixels.
 */
export function coverFit(box: { w: number; h: number }, canvas: [number, number], keep: Rect, dpr: number, fractional = false): Cover {
  const d = dpr > 0 ? dpr : 1;
  if (fractional) return fractionalFit(box, canvas, keep, d);
  const [kx, ky, kw, kh] = keep;
  const s = fitScale(box, [kw, kh], d);
  const aw = canvas[0] * s;
  const ah = canvas[1] * s;
  if (box.w > 0 && box.h > 0 && aw >= box.w - EPS && ah >= box.h - EPS) {
    // The offsets that keep the art covering the view and `keep` inside it, on the device grid.
    const place = (view: number, art: number, k0: number, k1: number): number | null => {
      const lo = Math.ceil(Math.max(view - art, -k0 * s) * d - EPS) / d;
      const hi = Math.floor(Math.min(0, view - k1 * s) * d + EPS) / d;
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

const hits = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * Where each open place's small label stands (its top-left, map pixels; Esme, 2026-11-17: "a little
 * label subtle underneath"): centred under the place, or over its own foot when another place sits
 * right under it, and only where it clears every other place and every label already placed, inside
 * the map. A place left out is named by the hover tooltip. Worked out from the bboxes alone, so a
 * redrawn map's labels follow it.
 */
export function placeLabels(open: readonly { key: string; name: string; bbox: Rect }[], all: readonly { key: string; bbox: Rect }[],
  size: (name: string) => [number, number], canvas: [number, number]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const taken: Rect[] = [];
  for (const p of open) {
    const [w, h] = size(p.name);
    const [bx, by, bw, bh] = p.bbox;
    const x = Math.round(bx + bw / 2 - w / 2);
    const clear = (r: Rect) => r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= canvas[0] && r[1] + r[3] <= canvas[1] &&
      !all.some((q) => q.key !== p.key && hits(r, q.bbox)) && !taken.some((t) => hits(r, t));
    const spot = ([[x, by + bh + 1, w, h], [x, by + bh - h, w, h]] as Rect[]).find(clear);
    if (!spot) continue;
    taken.push(spot);
    out.set(p.key, [spot[0], spot[1]]);
  }
  return out;
}

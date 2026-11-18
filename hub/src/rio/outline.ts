// Esme's Rio: the line round a place she can visit on the map (Esme, 2026-11-17: "Visitable areas
// on map should have some sign you can go there"). Each place's open layer is a cut-out, so the
// line follows its art: the transparent pixels touching it (the inner ring) and the ones touching
// those (the outer ring), drawn one art pixel each in the kit's cream and ink, as the doors are.

import type { Rect } from "./assets";

export interface Rings {
  /** x, y pairs (flat) of the ring touching the art. */
  inner: number[];
  /** x, y pairs (flat) of the ring round that. */
  outer: number[];
}

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The two rings round the opaque pixels of `rgba` (w x h) inside `box`, kept within the picture. */
export function outlineRings(rgba: Uint8ClampedArray, w: number, h: number, box: Rect): Rings {
  const x0 = Math.max(0, box[0] - 2);
  const y0 = Math.max(0, box[1] - 2);
  const x1 = Math.min(w, box[0] + box[2] + 2);
  const y1 = Math.min(h, box[1] + box[3] + 2);
  const inBox = (x: number, y: number) => x >= x0 && y >= y0 && x < x1 && y < y1;
  const solid = (x: number, y: number) => inBox(x, y) && rgba[(y * w + x) * 4 + 3]! > 0;
  const art = new Set<number>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (solid(x, y)) art.add(y * w + x);
  const ring = (from: Set<number>, not: Set<number>[]): Set<number> => {
    const out = new Set<number>();
    for (const i of from) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!not.some((s) => s.has(j))) out.add(j);
      }
    }
    return out;
  };
  const inner = ring(art, [art]);
  const outer = ring(inner, [art, inner]);
  const flat = (s: Set<number>) => [...s].flatMap((i) => [i % w, Math.floor(i / w)]);
  return { inner: flat(inner), outer: flat(outer) };
}

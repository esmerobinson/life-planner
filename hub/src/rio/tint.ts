// Esme's Rio: placed stickers in a scene's night or rain colours. The museum's README: "Finds
// placed by the game as stickers are in day colours. They should be tinted with the same
// night/rain twin". Each day colour's twin is read from the scene's own day and look pictures
// (the colour it most often becomes there); a colour the scene doesn't use follows its nearest
// scene colour's change, channel by channel. Pure functions over RGBA bytes, plus a canvas helper.

const rgb = (d: Uint8ClampedArray, i: number) => (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;

/** Day colour → look colour, from two same-size RGBA pictures of one scene. */
export function buildTint(day: Uint8ClampedArray, look: Uint8ClampedArray): Map<number, number> {
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i + 3 < day.length && i + 3 < look.length; i += 4) {
    if (day[i + 3] === 0 || look[i + 3] === 0) continue;
    const from = rgb(day, i);
    const to = rgb(look, i);
    let v = votes.get(from);
    if (!v) votes.set(from, (v = new Map()));
    v.set(to, (v.get(to) ?? 0) + 1);
  }
  const out = new Map<number, number>();
  for (const [from, v] of votes) {
    let best = -1;
    let n = 0;
    for (const [to, c] of v) if (c > n) [best, n] = [to, c];
    out.set(from, best);
  }
  return out;
}

const ch = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;

/** Recolours RGBA bytes in place to the look (alpha and transparent pixels kept). */
export function recolour(px: Uint8ClampedArray, tint: ReadonlyMap<number, number>): void {
  if (tint.size === 0) return;
  const keys = [...tint.keys()].map((k) => [k, ...ch(k)] as const);
  const memo = new Map<number, number>();
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const c = rgb(px, i);
    let to = tint.get(c) ?? memo.get(c);
    if (to === undefined) {
      const [r, g, b] = ch(c);
      let near = keys[0]!;
      let dist = Infinity;
      for (const k of keys) {
        const d = (k[1] - r) ** 2 + (k[2] - g) ** 2 + (k[3] - b) ** 2;
        if (d < dist) [near, dist] = [k, d];
      }
      const [lr, lg, lb] = ch(tint.get(near[0])!);
      const scale = (v: number, day: number, lk: number) => Math.max(0, Math.min(255, Math.round(day === 0 ? lk + v : (v * lk) / day)));
      to = (scale(r, near[1], lr) << 16) | (scale(g, near[2], lg) << 8) | scale(b, near[3], lb);
      memo.set(c, to);
    }
    px[i] = (to >> 16) & 255;
    px[i + 1] = (to >> 8) & 255;
    px[i + 2] = to & 255;
  }
}

const pixels = (img: CanvasImageSource, w: number, h: number): Uint8ClampedArray | null => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) return null;
  x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, w, h).data;
};

const tints = new Map<string, Map<number, number>>();

/** The twin for a scene's day and look pictures (cached by their paths). */
export function tintFor(key: string, day: HTMLImageElement, look: HTMLImageElement): Map<number, number> {
  let t = tints.get(key);
  if (!t) {
    const a = pixels(day, day.width, day.height);
    const b = pixels(look, look.width, look.height);
    t = a && b ? buildTint(a, b) : new Map();
    tints.set(key, t);
  }
  return t;
}

/** Draws `draw` (at the given box) into an offscreen canvas, recolours it, and puts it on ctx. */
export function drawTinted(ctx: CanvasRenderingContext2D, tint: ReadonlyMap<number, number>, box: { x: number; y: number; w: number; h: number },
  draw: (c: CanvasRenderingContext2D, x: number, y: number) => void): void {
  const off = document.createElement("canvas");
  off.width = box.w;
  off.height = box.h;
  const o = off.getContext("2d");
  if (!o) return;
  o.imageSmoothingEnabled = false;
  draw(o, 0, 0);
  const data = o.getImageData(0, 0, box.w, box.h);
  recolour(data.data, tint);
  o.putImageData(data, 0, 0);
  ctx.drawImage(off, Math.round(box.x), Math.round(box.y));
}

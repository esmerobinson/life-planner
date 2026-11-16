// Esme's Rio: loading the pack's pictures and placing a canvas in the game's view (shared by the
// map and the areas). Drawing itself uses farm/sprites.ts's helpers (ctx2d: smoothing off).

import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { canDraw } from "../farm/sprites";
import { rioUrl } from "./assets";
import { coverFit, type Cover } from "./mapMath";

const cache = new Map<string, Promise<HTMLImageElement>>();

/** One pack picture (pack-relative path), loaded once. */
export function loadRioImage(path: string): Promise<HTMLImageElement> {
  let p = cache.get(path);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${path}`));
      img.src = rioUrl(path);
    });
    cache.set(path, p);
  }
  return p;
}

export type RioImages = Record<string, HTMLImageElement>;

/**
 * The pictures, once every one has loaded (null until then, and always in tests). A picture that
 * fails to load is left out, so one missing file never blanks the whole scene.
 */
export function useRioImages(paths: readonly string[]): RioImages | null {
  const key = paths.join("|");
  const [images, setImages] = useState<{ key: string; images: RioImages } | null>(null);
  useEffect(() => {
    if (!canDraw()) return;
    let live = true;
    void Promise.all(paths.map((p) => loadRioImage(p).then((img) => [p, img] as const, () => null))).then((pairs) => {
      if (live) setImages({ key, images: Object.fromEntries(pairs.filter((x): x is readonly [string, HTMLImageElement] => !!x)) });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return images?.key === key ? images.images : null;
}

/**
 * Where a canvas of `canvas` art pixels sits in the game's view (rio/GameScreen.tsx's
 * .game-view; outside the game, its parent and the window's height): at a crisp scale, covering
 * the view so the plank border stays even, never trimming `keep` (mapMath.ts coverFit).
 */
export function useCover(ref: RefObject<HTMLElement | null>, canvas: [number, number], keep: [number, number, number, number], fractional = false): Cover {
  const [box, setBox] = useState({ w: 0, h: 0, dpr: 1 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = el.closest<HTMLElement>(".game-view");
    const measure = () => {
      const next = view
        ? { w: view.clientWidth, h: view.clientHeight, dpr: window.devicePixelRatio || 1 }
        : { w: el.parentElement?.clientWidth ?? 0, h: window.innerHeight, dpr: window.devicePixelRatio || 1 };
      setBox((b) => (b.w === next.w && b.h === next.h && b.dpr === next.dpr ? b : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(view ?? el.parentElement ?? el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref]);
  const [kx, ky, kw, kh] = keep;
  return useMemo(() => coverFit(box, canvas, [kx, ky, kw, kh], box.dpr, fractional), [box, canvas, kx, ky, kw, kh, fractional]);
}

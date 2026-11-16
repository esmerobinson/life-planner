// Esme's Rio: loading the pack's pictures and fitting a canvas to the window (shared by the map
// and the areas). Drawing itself uses farm/sprites.ts's helpers (ctx2d: smoothing off).

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { canDraw } from "../farm/sprites";
import { rioUrl } from "./assets";
import { fitScale } from "./mapMath";

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

/** The page's padding below the content (the same as above it; the map keeps clear of it). */
function pageGap(el: HTMLElement): number {
  const content = el.closest(".app-content");
  if (!content) return 0;
  return parseFloat(getComputedStyle(content).paddingTop) || 0;
}

/** How far down the page `el` starts (whatever sits above it: the page title, a banner). */
const pageTop = (el: HTMLElement): number => el.getBoundingClientRect().top + (window.scrollY || 0);

/**
 * The CSS scale at which `canvas` fits both the width of `ref`'s parent and the window's height
 * below where `ref` starts on the page (less `reserve` CSS px for what sits with it on screen),
 * at the largest crisp size: so it is whole on screen as the page opens, with no scrolling.
 */
export function useFit(ref: RefObject<HTMLElement | null>, canvas: [number, number], reserve = 0): number {
  const [box, setBox] = useState({ w: canvas[0], h: canvas[1], dpr: 1 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // In the game screen (rio/GameScreen.tsx) the art fits the screen itself.
    const screen = el.closest<HTMLElement>(".game-screen");
    const measure = () => {
      const host = el.parentElement ?? el;
      const next = screen
        ? { w: screen.clientWidth, h: screen.clientHeight - reserve, dpr: window.devicePixelRatio || 1 }
        : { w: host.clientWidth, h: window.innerHeight - pageTop(el) - pageGap(el) - reserve, dpr: window.devicePixelRatio || 1 };
      setBox((b) => (b.w === next.w && b.h === next.h && b.dpr === next.dpr ? b : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(screen ?? el.parentElement ?? el);
    // What sits above it can change height (a banner comes and goes): the page's size changes too.
    const page = el.closest(".app-content");
    if (page) ro?.observe(page);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref, reserve]);
  return fitScale(box, canvas, box.dpr);
}

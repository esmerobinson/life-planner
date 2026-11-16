// Esme's Rio: the approved UI kit (art/options/esme-ui, Esme 2026-11-09: "pretty good"), copied in
// by scripts/import-rio-ui.mjs. Pieces are drawn at 1x and shown at a whole-number scale; nine-slice
// pieces carry their slice (CSS border-image order: top, right, bottom, left).

import { useEffect, useState } from "react";
import rawKit from "../../assets/rio-ui/kit/kit.json";
import { canDraw } from "../../farm/sprites";

const URLS = import.meta.glob("../../assets/rio-ui/kit/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export interface KitPiece {
  w: number;
  h: number;
  slice?: [number, number, number, number];
  frames?: number;
  frame_w?: number;
}

export const KIT = (rawKit as unknown as { pieces: Record<string, KitPiece> }).pieces;

/** The bundled URL of a kit piece, "" if the kit has none by that name. */
export const kitUrl = (name: string): string => URLS[`../../assets/rio-ui/kit/${name}.png`] ?? "";

/** The kit's text colours, as its mockups use them (esme-ui src/screens_c_more.js CC, core.js). */
export const INK = {
  ink: "#56160c",
  brown: "#7a3a1a",
  dark: "#2a1208",
  green: "#4c9c2c",
  purple: "#8c5bd2",
  cream: "#fff3d6",
  /** The text shadow on the orange word button. */
  buttonShadow: "#853605",
} as const;

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadKit(name: string): Promise<HTMLImageElement> {
  let p = cache.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`No kit piece ${name}`));
      img.src = kitUrl(name);
    });
    cache.set(name, p);
  }
  return p;
}

/** Kit pieces for drawing on a canvas, once loaded (null until then, and always in tests). */
export function useKitImages(names: readonly string[]): Record<string, HTMLImageElement> | null {
  const key = names.join("|");
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement> | null>(null);
  useEffect(() => {
    if (!canDraw()) return;
    let live = true;
    void Promise.all(names.map((n) => loadKit(n).then((i) => [n, i] as const))).then(
      (pairs) => live && setImgs(Object.fromEntries(pairs)),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return imgs;
}

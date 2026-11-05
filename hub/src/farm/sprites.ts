// Esme's Farm: loading the art pack's sprite sheets and drawing frames onto canvases.
// Every sheet is a horizontal strip of equal frames (Aseprite JSON, "array" layout). Canvases are
// drawn at 1x and shown at a whole-number scale with `image-rendering: pixelated`.

import { useEffect, useState } from "react";
import { MANIFEST, asset } from "./catalogue";
import type { CharacterId } from "./state";

const URLS = import.meta.glob("../assets/farm/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export const sheetUrl = (name: string): string => URLS[`../assets/farm/${name}.png`] ?? "";

/** No canvas in the test DOM (jsdom): drawing is skipped there. */
export const canDraw = (): boolean =>
  typeof navigator !== "undefined" && !/jsdom/i.test(navigator.userAgent) && typeof document !== "undefined";

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadSheet(name: string): Promise<HTMLImageElement> {
  let p = cache.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${name}`));
      img.src = sheetUrl(name);
    });
    cache.set(name, p);
  }
  return p;
}

export type Sheets = Record<string, HTMLImageElement>;

/** The named sheets, once every one has loaded (null until then, and always in tests). */
export function useSheets(names: readonly string[]): Sheets | null {
  const key = names.join("|");
  const [sheets, setSheets] = useState<Sheets | null>(null);
  useEffect(() => {
    if (!canDraw()) return;
    let live = true;
    void Promise.all(names.map((n) => loadSheet(n).then((img) => [n, img] as const))).then(
      (pairs) => live && setSheets(Object.fromEntries(pairs)),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return sheets;
}

/** Draws frame `index` of a strip sheet with frames `w`x`h` at (x, y). */
export function drawFrame(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, index: number, x: number, y: number): void {
  ctx.drawImage(img, index * w, 0, w, h, Math.round(x), Math.round(y), w, h);
}

/** A 2D context with smoothing off (never blur pixel art). */
export function ctx2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas || !canDraw()) return null;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
  return ctx;
}

// ---- recolouring (the farm's asleep / dimmed looks use the manifest's colour maps) -----------

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** Every opaque pixel's colour passed through `map` (colours not in it are kept). */
export function recolour(src: CanvasImageSource & { width: number; height: number }, map: (h: string) => string | undefined): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const to = map(hex(px[i]!, px[i + 1]!, px[i + 2]!));
    if (to) [px[i], px[i + 1], px[i + 2]] = rgb(to);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

const FARM = asset("farm-base") as unknown as {
  dim_map_highlight: { dark_to: string; light_to: string; dark_colours: string[] };
};

/** The highlight rule's dimming: dark colours -> stone, the rest -> paper. */
export function dimColour(h: string): string {
  const d = FARM.dim_map_highlight;
  return d.dark_colours.includes(h) ? d.dark_to : d.light_to;
}

// ---- characters and accessories -------------------------------------------------------------

export const CHAR_FRAME = 32;
export const ACC_FRAME = 24;

/** Each character's body box inside its 32x32 frame (accessories go here). */
export const BODY_BOX: Record<CharacterId, [number, number]> = Object.fromEntries(
  (["domino", "bap", "puddle", "clover", "crumpet", "duvet"] as CharacterId[]).map((c) => [
    c, (asset(`char-${c}`) as unknown as { body_box_offset: [number, number] }).body_box_offset,
  ]),
) as Record<CharacterId, [number, number]>;

export type Pose = "idle" | "sleep" | "happy" | "encourage" | "sit";

/** The frames of a pose (Bap has "sit" where the others have "encourage"). */
export function poseFrames(c: CharacterId, pose: Pose): number[] {
  const tags = asset(`char-${c}`).tags;
  const t = tags.find((x) => x.name === pose) ?? tags.find((x) => x.name === "idle")!;
  return Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
}

/** Frames whose head bobs down 1px (idle frame 2, sleep frames 2–3): head items follow. */
export function headBobs(c: CharacterId, frame: number): boolean {
  const tags = asset(`char-${c}`).tags;
  const idle = tags.find((t) => t.name === "idle")!;
  const sleep = tags.find((t) => t.name === "sleep")!;
  return frame === idle.from + 2 || frame === sleep.from + 2 || frame === sleep.from + 3;
}

const headItemCache = new Map<string, boolean>();

/** An accessory worn on the head (it moves with a head bob): its lowest pixel sits in the top part. */
function isHeadItem(acc: HTMLImageElement, frame: number): boolean {
  const k = `${acc.src}#${frame}`;
  const known = headItemCache.get(k);
  if (known !== undefined) return known;
  const c = document.createElement("canvas");
  c.width = ACC_FRAME;
  c.height = ACC_FRAME;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(acc, frame * ACC_FRAME, 0, ACC_FRAME, ACC_FRAME, 0, 0, ACC_FRAME, ACC_FRAME);
  const px = ctx.getImageData(0, 0, ACC_FRAME, ACC_FRAME).data;
  let bottom = -1;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) bottom = Math.floor((i - 3) / 4 / ACC_FRAME);
  const head = bottom >= 0 && bottom < 15;
  headItemCache.set(k, head);
  return head;
}

/** Draws a character frame and (optionally) its accessory overlay at the body box. */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  c: CharacterId,
  frame: number,
  x: number,
  y: number,
  accessoryFrame: number | null,
  dim = false,
): void {
  const sheet = dim ? dimmedSheet(sheets[`char-${c}`]!) : sheets[`char-${c}`]!;
  drawFrame(ctx, sheet, CHAR_FRAME, CHAR_FRAME, frame, x, y);
  const acc = sheets[`acc-${c}`];
  if (accessoryFrame === null || !acc) return;
  const [bx, by] = BODY_BOX[c];
  const bob = headBobs(c, frame) && isHeadItem(acc, accessoryFrame) ? 1 : 0;
  drawFrame(ctx, dim ? dimmedSheet(acc) : acc, ACC_FRAME, ACC_FRAME, accessoryFrame, x + bx, y + by + bob);
}

const dimmed = new WeakMap<object, HTMLCanvasElement>();
export function dimmedSheet(img: HTMLImageElement): HTMLCanvasElement {
  let d = dimmed.get(img);
  if (!d) {
    d = recolour(img, dimColour);
    dimmed.set(img, d);
  }
  return d;
}

// ---- the pixel font (font-small) -------------------------------------------------------------

const FONT = asset("font-small") as unknown as { glyph_widths: Record<string, number>; tags: { name: string; from: number }[] };
const GLYPH = new Map(FONT.tags.map((t) => [t.name, t.from]));

/** Width in pixels of a text in the pixel font (advance = glyph width + 1). */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += (FONT.glyph_widths[ch] ?? FONT.glyph_widths[" "]!) + 1;
  return Math.max(0, w - 1);
}

/** Draws text in the pixel font (upper case) at (x, y), its top-left. */
export function drawText(ctx: CanvasRenderingContext2D, font: HTMLImageElement, text: string, x: number, y: number): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const i = GLYPH.get(ch);
    const w = FONT.glyph_widths[ch] ?? FONT.glyph_widths[" "]!;
    if (i !== undefined) ctx.drawImage(font, i * 5, 0, w, 5, cx, y, w, 5);
    cx += w + 1;
  }
}

/** The palette (for the few flat fills the app draws, e.g. the placeholder spot mark). */
export const PALETTE = MANIFEST.palette;
/** Undecided: obviously wrong on purpose (tokens.css --placeholder). */
export const PLACEHOLDER = "#ff00ff";

export type StickerLook = "sticker" | "ghost" | "diecut";
const LOOK: Record<StickerLook, { sheet: string; size: number }> = {
  sticker: { sheet: "stickers", size: 16 },
  ghost: { sheet: "stickers-ghost", size: 16 },
  diecut: { sheet: "stickers-diecut", size: 18 },
};

/**
 * Draws one sticker (its art, or for a sticker with no art yet the obvious magenta placeholder:
 * a filled square, or an outline for its ghost), optionally mirrored.
 */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  s: { index: number; placeholderArt?: true },
  look: StickerLook,
  x: number,
  y: number,
  flip = false,
): void {
  const { sheet, size } = LOOK[look];
  if (s.placeholderArt || s.index < 0) {
    ctx.fillStyle = PLACEHOLDER;
    if (look === "ghost") {
      ctx.fillRect(x + 1, y + 1, size - 2, 1);
      ctx.fillRect(x + 1, y + size - 2, size - 2, 1);
      ctx.fillRect(x + 1, y + 1, 1, size - 2);
      ctx.fillRect(x + size - 2, y + 1, 1, size - 2);
    } else ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    return;
  }
  const img = sheets[sheet];
  if (!img) return;
  if (!flip) return drawFrame(ctx, img, size, size, s.index, x, y);
  ctx.save();
  ctx.translate(Math.round(x) + size, Math.round(y));
  ctx.scale(-1, 1);
  ctx.drawImage(img, s.index * size, 0, size, size, 0, 0, size, size);
  ctx.restore();
}

const BADGE = asset("badge-count") as unknown as {
  height: number; left_w: number; right_w: number; text_offset: [number, number]; show_from: number;
  slices: { left_cap: [number, number]; middle_column: number; right_cap: [number, number] };
};

/**
 * The ×N badge (badge-count, Esme, 2026-11-04) on a repeatable sticker whose top-left is (x, y):
 * the left cap (with its ×), the middle column repeated for the digits' width, the right cap; the
 * digits in the pixel font; its bottom-right pixel at (x + 17, y + 17). Shown from ×2.
 */
export function drawBadge(ctx: CanvasRenderingContext2D, sheets: Sheets, n: number, x: number, y: number): void {
  const img = sheets["badge-count"];
  const font = sheets["font-small"];
  if (n < BADGE.show_from || !img || !font) return;
  const digits = String(n);
  const tw = textWidth(digits);
  const w = BADGE.left_w + tw + BADGE.right_w;
  const left = Math.round(x) + 18 - w;
  const top = Math.round(y) + 18 - BADGE.height;
  const [l0] = BADGE.slices.left_cap;
  const [r0] = BADGE.slices.right_cap;
  ctx.drawImage(img, l0, 0, BADGE.left_w, BADGE.height, left, top, BADGE.left_w, BADGE.height);
  for (let i = 0; i < tw; i++) ctx.drawImage(img, BADGE.slices.middle_column, 0, 1, BADGE.height, left + BADGE.left_w + i, top, 1, BADGE.height);
  ctx.drawImage(img, r0, 0, BADGE.right_w, BADGE.height, left + BADGE.left_w + tw, top, BADGE.right_w, BADGE.height);
  drawText(ctx, font, digits, left + BADGE.text_offset[0], top + BADGE.text_offset[1]);
}

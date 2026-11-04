// Esme's Farm: the farm beneath the book. One canvas at a whole-number scale (1x fits the Mac
// panel, 2x where there's room; on the phone it pans to the highlighted part at 2x). Built per the
// art pack: draw farm-base "asleep", copy the "awake" pixels inside each awake zone's mask, then
// the beds (stage from earned bed stickers), the museum door (until Duvet), and then placed
// stickers and characters together in z order (sticker-spots.json; characters use their
// body-box bottom). With a book page open, everything outside its zone(s) is dimmed by the
// manifest's highlight rule and the zone's outline is drawn on top.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MANIFEST, STICKER_BY_KEY, asset } from "./catalogue";
import type { FarmView } from "./FarmContext";
import { useTicker } from "./hooks";
import { IDLE_FRAME_MS, POP_FRAME_MS, reducedMotion } from "./motion";
import {
  PLACEHOLDER, ctx2d, dimColour, dimmedSheet, drawCharacter, drawCount, drawFrame, drawSticker, poseFrames, useSheets, type Sheets,
} from "./sprites";
import { CHARACTERS, type CharacterId } from "./state";
import { ACCESSORIES, BED_ORDER, BED_POSITIONS, NAMES, SPOTS, bedStageEarned, repeatCount } from "./world";

const BASE = asset("farm-base") as unknown as { frame: [number, number] };
export const FARM_W = BASE.frame[0];
export const FARM_H = BASE.frame[1];
const MASKS = asset("farm-zone-masks") as unknown as { zones: string[]; bboxes: Record<string, [number, number, number, number]> };
const DOOR = asset("farm-museum-door") as unknown as { position: [number, number]; frame: [number, number] };
const SHEETS = [
  "farm-base", "farm-zone-masks", "farm-zone-outlines", "farm-beds", "farm-museum-door", "stickers", "fx-sparkle", "font-small",
  ...CHARACTERS.map((c) => `char-${c}`), ...CHARACTERS.map((c) => `acc-${c}`),
];

/** Where each character stands on the farm, its zone and draw order (manifest farm_character_spots). */
const SPOT_OF: Record<CharacterId, { zone: string; at: [number, number]; z: number }> = Object.fromEntries(
  CHARACTERS.map((c) => {
    const s = MANIFEST.farm_character_spots[c] as unknown as { zone: string; frame_topleft: [number, number]; z?: number };
    return [c, { zone: s.zone.split(" ")[0]!, at: s.frame_topleft, z: s.z ?? s.frame_topleft[1] + 30 }];
  }),
) as Record<CharacterId, { zone: string; at: [number, number]; z: number }>;

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Each zone's mask as one flag per pixel (read once). */
const maskCache = new WeakMap<object, Map<string, Uint8Array>>();
function masks(s: Sheets): Map<string, Uint8Array> {
  const img = s["farm-zone-masks"]!;
  let m = maskCache.get(img);
  if (m) return m;
  m = new Map();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  MASKS.zones.forEach((zone, z) => {
    const flags = new Uint8Array(FARM_W * FARM_H);
    for (let y = 0; y < FARM_H; y++) {
      for (let x = 0; x < FARM_W; x++) flags[y * FARM_W + x] = data[(y * img.width + z * FARM_W + x) * 4 + 3]! > 0 ? 1 : 0;
    }
    m!.set(zone, flags);
  });
  maskCache.set(img, m);
  return m;
}

interface StaticInput {
  awake: ReadonlySet<string>;
  stages: number[];
  doorClosed: boolean;
  highlight: readonly string[];
}

/** The ground of the farm: base, awake zones, beds, door, the highlight rule (redrawn only when it changes). */
function drawStatic(s: Sheets, inp: StaticInput): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = FARM_W;
  c.height = FARM_H;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const m = masks(s);
  drawFrame(ctx, s["farm-base"]!, FARM_W, FARM_H, 1, 0, 0); // asleep
  if (inp.awake.size > 0) {
    const awake = document.createElement("canvas");
    awake.width = FARM_W;
    awake.height = FARM_H;
    const actx = awake.getContext("2d")!;
    drawFrame(actx, s["farm-base"]!, FARM_W, FARM_H, 0, 0, 0);
    const from = actx.getImageData(0, 0, FARM_W, FARM_H);
    const to = ctx.getImageData(0, 0, FARM_W, FARM_H);
    const zones = [...inp.awake].map((z) => m.get(z)).filter((x): x is Uint8Array => !!x);
    for (let i = 0; i < FARM_W * FARM_H; i++) {
      if (!zones.some((z) => z[i])) continue;
      for (let k = 0; k < 4; k++) to.data[i * 4 + k] = from.data[i * 4 + k]!;
    }
    ctx.putImageData(to, 0, 0);
  }
  BED_ORDER.forEach((area, a) => {
    const [x, y] = BED_POSITIONS[area]!;
    drawFrame(ctx, s["farm-beds"]!, 26, 16, a * 6 + inp.stages[a]!, x, y);
  });
  if (inp.doorClosed) drawFrame(ctx, s["farm-museum-door"]!, DOOR.frame[0], DOOR.frame[1], 0, DOOR.position[0], DOOR.position[1]);
  if (inp.highlight.length > 0) {
    const on = inp.highlight.map((z) => m.get(z)).filter((x): x is Uint8Array => !!x);
    const img = ctx.getImageData(0, 0, FARM_W, FARM_H);
    const px = img.data;
    for (let i = 0; i < FARM_W * FARM_H; i++) {
      if (px[i * 4 + 3] === 0 || on.some((z) => z[i])) continue;
      const to = dimColour(hex(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!));
      px[i * 4] = parseInt(to.slice(1, 3), 16);
      px[i * 4 + 1] = parseInt(to.slice(3, 5), 16);
      px[i * 4 + 2] = parseInt(to.slice(5, 7), 16);
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

export interface SceneProps {
  view: FarmView;
  phone: boolean;
  highlight: readonly string[];
  /** A sticker just placed: it pops at its spot. */
  popKey: string | null;
  onZone: (zone: string) => void;
  onCharacter: (c: CharacterId) => void;
}

export function FarmScene({ view, phone, highlight, popKey, onZone, onCharacter }: SceneProps) {
  const sheets = useSheets(SHEETS);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(FARM_W * 2);
  const tick = useTicker(IDLE_FRAME_MS);
  const [pop, setPop] = useState<{ key: string; frame: number } | null>(null);
  const scale = phone ? 2 : Math.max(1, Math.min(2, Math.floor(avail / FARM_W)));

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Beds grow from EARNED stickers, so they never shrink (review I3).
  const stages = BED_ORDER.map((area) => bedStageEarned(area, view.earnedSet));
  const staticKey = [[...view.awake].sort().join(), stages.join(), view.arrived.has("duvet"), highlight.join()].join("|");
  const layer = useMemo(
    () => (sheets ? drawStatic(sheets, { awake: view.awake, stages, doorClosed: !view.arrived.has("duvet"), highlight }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheets, staticKey],
  );

  // Placed farm stickers that show a sprite, in z order (bed stickers are the bed's own stage art).
  const placed = useMemo(
    () =>
      [...view.state.placed.keys()]
        .flatMap((key) => {
          const spot = SPOTS.get(key);
          const st = STICKER_BY_KEY.get(key);
          return spot && st && spot.scene === "farm" && spot.draw ? [{ key, spot, st }] : [];
        }),
    [view.state.placed],
  );

  // A placed sticker pops at its spot (fx-sparkle).
  useEffect(() => {
    if (!popKey || reducedMotion()) return;
    let f = 0;
    setPop({ key: popKey, frame: 0 });
    const t = setInterval(() => {
      f++;
      if (f >= 3) {
        clearInterval(t);
        setPop(null);
      } else setPop({ key: popKey, frame: f });
    }, POP_FRAME_MS);
    return () => clearInterval(t);
  }, [popKey]);

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets || !layer) return;
    ctx.clearRect(0, 0, FARM_W, FARM_H);
    ctx.drawImage(layer, 0, 0);
    const dimmed = (zone: string) => highlight.length > 0 && !highlight.includes(zone);
    const stickerSheets = { ...sheets, stickers: sheets["stickers"]! } as Sheets;
    const dimSheets = { ...sheets, stickers: dimmedSheet(sheets["stickers"]!) as unknown as HTMLImageElement } as Sheets;
    const things: { z: number; draw: () => void }[] = [];
    for (const p of placed) {
      const { spot, st, key } = p;
      things.push({
        z: spot.z,
        draw: () => {
          drawSticker(ctx, dimmed(spot.zone) ? dimSheets : stickerSheets, st, "sticker", spot.x, spot.y, spot.flip);
          drawCount(ctx, sheets["font-small"]!, repeatCount(key, view.counters), spot.x, spot.y);
          if (spot.placeholder) {
            // PLACEHOLDER SPOT (no designed position yet): an obviously wrong magenta mark.
            ctx.fillStyle = PLACEHOLDER;
            ctx.fillRect(spot.x + 6, spot.y + 16, 4, 1);
          }
        },
      });
    }
    for (const c of CHARACTERS) {
      if (!view.arrived.has(c)) continue;
      const loop = poseFrames(c, "idle");
      const outfit = view.state.outfits.get(c) ?? null;
      const acc = outfit && view.unlocked.includes(outfit) ? ACCESSORIES.find((a) => a.code === outfit)?.frame ?? null : null;
      const { zone, at, z } = SPOT_OF[c];
      things.push({ z, draw: () => drawCharacter(ctx, sheets, c, loop[tick % loop.length]!, at[0], at[1], acc, dimmed(zone)) });
    }
    things.sort((a, b) => a.z - b.z).forEach((t) => t.draw());
    for (const z of highlight) {
      const idx = MASKS.zones.indexOf(z);
      if (idx >= 0) drawFrame(ctx, sheets["farm-zone-outlines"]!, FARM_W, FARM_H, idx, 0, 0);
    }
    const spot = pop && SPOTS.get(pop.key);
    if (pop && spot && spot.scene === "farm") drawFrame(ctx, sheets["fx-sparkle"]!, 30, 30, pop.frame, spot.x + 8 - 15, spot.y + 8 - 15);
  }, [sheets, layer, tick, placed, view.arrived, view.state.outfits, view.unlocked, view.counters, highlight, pop]);

  // On the phone, pan to the highlighted part.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !phone || highlight.length === 0) return;
    const boxes = highlight.map((z) => MASKS.bboxes[z]).filter((b): b is [number, number, number, number] => !!b);
    if (boxes.length === 0) return;
    const cx = (Math.min(...boxes.map((b) => b[0])) + Math.max(...boxes.map((b) => b[2]))) / 2;
    el.scrollLeft = Math.max(0, cx * scale - el.clientWidth / 2);
  }, [phone, highlight, scale]);

  return (
    <div className="farm-scene" ref={scroller} data-awake={[...view.awake].sort().join(" ")} data-highlight={highlight.join(" ")}>
      <div className="farm-scene-layer" style={{ width: FARM_W * scale, height: FARM_H * scale }}>
        <canvas ref={canvas} width={FARM_W} height={FARM_H} className="farm-px" style={{ width: FARM_W * scale, height: FARM_H * scale }}
          aria-label={`The farm. Awake: ${view.awake.size ? [...view.awake].join(", ") : "nothing yet"}.`} role="img" />
        {MASKS.zones.map((z) => {
          const [x0, y0, x1, y1] = MASKS.bboxes[z]!;
          return (
            <button key={z} type="button" className="farm-zone-hit" data-zone={z} aria-label={`Open the book at the ${z}`}
              style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }}
              onClick={() => onZone(z)} />
          );
        })}
        {CHARACTERS.filter((c) => view.arrived.has(c)).map((c) => {
          const [x, y] = SPOT_OF[c].at;
          return (
            <button key={c} type="button" className="farm-char-hit" data-character={c} aria-label={NAMES[c]}
              style={{ left: (x + 4) * scale, top: (y + 4) * scale, width: 24 * scale, height: 24 * scale }}
              onClick={() => onCharacter(c)} />
          );
        })}
      </div>
    </div>
  );
}

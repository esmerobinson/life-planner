// Esme's Rio: the map. One canvas at a crisp size, covering the game's view without trimming any
// place (or, if it can't, the whole map fitted: mapMath.ts coverFit); it never scrolls. Drawn
// drawn as map.json says: the base for the look, the boat route, each place's open or locked
// layer, then the markers (the padlock on the next place, NEW until the first visit). A place she
// can visit wears a solid line round its art and a small label under it; pointing at it lifts it
// a pixel and names it (Esme, 2026-11-17: "Visitable areas on map should have some sign you can
// go there … maybe even a little label subtle underneath too. Then hovering them again makes them
// react"). Places under cloud have neither. A hidden list of buttons mirrors it for the keyboard
// and screen readers.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion, useTicker } from "../farm/hooks";
import { ctx2d } from "../farm/sprites";
import { opensOn, type AreaStatus } from "./areas";
import { MAP_DIR, RIO_MAP, mapBase, mapLayer, mapLook, type Look, type RioEvent } from "./assets";
import { activeEvent, eventLook, useNow } from "./events";
import { useCover, useRioImages, type RioImages } from "./canvas";
import { MAP_KEEP, hitPlace } from "./mapMath";
import { outlineRings, type Rings } from "./outline";
import { BitmapText } from "./ui/BitmapText";
import { bodyPx, useUi } from "./ui/fit";
import { FONT } from "./ui/font";
import { INK } from "./ui/kit";
import { Tip } from "./ui/Tip";

const [W, H] = RIO_MAP.canvas;
const PLACE = new Map(RIO_MAP.places.map((p) => [p.key, p]));
const at = (p: string) => `${MAP_DIR}/${p}`;

const isOpen = (s: AreaStatus | undefined) => s === "open" || s === "new";
const RAIN = RIO_MAP.weather?.rain?.overlay;
/** The falling rain plays over the map's own rain look (none while the pack has no rain look). */
const rainsOn = (look: Look) => look === "rain" && mapLook(look, RIO_MAP.look_files) === "rain" && !!RAIN?.frames.length;

/** What a place says under its name (PLACEHOLDER WORDING). */
function tipFor(key: string, status: AreaStatus | undefined): string {
  if (isOpen(status)) return "Visit";
  if (status === "next") return `Opens on day ${opensOn(key)}`;
  return "Coming soon";
}

/** Free map pixels below a place for its label (map.json label_room; the old map had none: room enough). */
const LABEL_MIN_ROOM = 4;
const labelled = (p: { label_room?: { clear_px_below: number } }) => (p.label_room?.clear_px_below ?? LABEL_MIN_ROOM) >= LABEL_MIN_ROOM;

/** The kit's ink and cream (the line round an open place: cream on the art, ink round that). */
const LINE = { inner: "#fff3d6", outer: "#56160c" };

const rings = new Map<string, Rings>();
/** The line round a place's open layer (worked out once per picture). */
function ringsOf(img: HTMLImageElement, file: string, box: [number, number, number, number]): Rings | null {
  let r = rings.get(file);
  if (r) return r;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(img, 0, 0);
  try {
    r = outlineRings(x.getImageData(0, 0, img.width, img.height).data, img.width, img.height, box);
  } catch {
    return null;
  }
  rings.set(file, r);
  return r;
}

/** A takeover's layer (events.ts eventLook: on a rainy day the day layer; Réveillon's night till 06:00). */
const eventLayer = (e: RioEvent, layer: "day" | "night") => e.layers[layer];
const fireworksFor = (e: RioEvent | null, layer: "day" | "night") => (e && layer === "night" ? e.animation?.night : undefined);

function filesFor(look: Look, event: RioEvent | null, layer: "day" | "night"): string[] {
  const out = [at(mapBase(look)), at(RIO_MAP.markers.locked.file), at(RIO_MAP.markers.new.file)];
  for (const p of [...RIO_MAP.places, RIO_MAP.boat_route]) {
    out.push(at(mapLayer(p, look, "open")), at(mapLayer(p, look, "locked")));
  }
  if (rainsOn(look)) out.push(...RAIN!.frames.map(at));
  if (event) out.push(at(eventLayer(event, layer)), ...(fireworksFor(event, layer)?.frames ?? []).map(at));
  return out;
}

function drawMap(ctx: CanvasRenderingContext2D, img: RioImages, look: Look, statuses: ReadonlyMap<string, AreaStatus>, rainFrame: number | null,
  event: RioEvent | null, layer: "day" | "night", fireworksFrame: number | null, hover: string | null) {
  ctx.clearRect(0, 0, W, H);
  const put = (path: string, x = 0, y = 0) => {
    const i = img[at(path)];
    if (i) ctx.drawImage(i, x, y);
  };
  const markers: { file: string; at: [number, number] }[] = [];
  const lines: { key: string; file: string; box: [number, number, number, number] }[] = [];
  for (const key of RIO_MAP.draw_order) {
    if (key === "base") put(mapBase(look));
    else if (key === RIO_MAP.boat_route.key) {
      put(mapLayer(RIO_MAP.boat_route, look, isOpen(statuses.get(RIO_MAP.boat_route.links)) ? "open" : "locked"));
    } else if (key !== "markers") {
      const p = PLACE.get(key);
      if (!p) continue;
      const s = statuses.get(key);
      // The place she points at stands a pixel up.
      put(mapLayer(p, look, isOpen(s) ? "open" : "locked"), 0, isOpen(s) && hover === key ? -1 : 0);
      if (isOpen(s)) lines.push({ key, file: mapLayer(p, look, "open"), box: p.bbox });
      if (s === "next") markers.push({ file: RIO_MAP.markers.locked.file, at: p.marker_anchor });
      if (s === "new") markers.push({ file: RIO_MAP.markers.new.file, at: p.marker_anchor });
    }
  }
  // The line round each open place, over every place (they overlap), under the takeovers and markers.
  for (const l of lines) {
    const i = img[at(l.file)];
    const r = i ? ringsOf(i, l.file, l.box) : null;
    if (!r) continue;
    const dy = hover === l.key ? -1 : 0;
    for (const [pts, colour] of [[r.outer, LINE.outer], [r.inner, LINE.inner]] as const) {
      ctx.fillStyle = colour;
      for (let k = 0; k < pts.length; k += 2) ctx.fillRect(pts[k]!, pts[k + 1]! + dy, 1, 1);
    }
  }
  // A holiday takeover: after the last place, over open and locked alike, before the rain and markers.
  if (event) {
    put(eventLayer(event, layer));
    const fw = fireworksFor(event, layer);
    if (fw && fireworksFrame !== null) put(fw.frames[fireworksFrame % fw.frames.length]!);
  }
  // The falling rain: after the places, before the markers (map.json weather.rain).
  if (rainFrame !== null && RAIN) put(RAIN.frames[rainFrame % RAIN.frames.length]!);
  // Markers last, anchored at their bottom-centre.
  for (const m of markers) {
    const i = img[at(m.file)];
    if (i) ctx.drawImage(i, Math.round(m.at[0] - Math.floor(i.width / 2)), m.at[1] - i.height);
  }
}

export function RioMap({ statuses, look, now: fixedNow, onOpen }: {
  statuses: ReadonlyMap<string, AreaStatus>;
  look: Look;
  /** The moment the map shows (default: now, re-read each minute): it picks the holiday takeover. */
  now?: Date;
  onOpen: (area: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The desktop scales by fractions to fill the view (Esme, 2026-11-17); the phone stays crisp.
  const fit = useCover(wrap, RIO_MAP.canvas, MAP_KEEP, useUi().layout === "wide");
  const scale = fit.scale;
  const now = useNow(fixedNow);
  const event = activeEvent(now);
  const layer = event ? eventLook(event, now, look) : "day";
  const files = useMemo(() => filesFor(look, event, layer), [look, event, layer]);
  const images = useRioImages(files);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const raining = rainsOn(look) && !reduced;
  const rainTick = useTicker(RAIN?.frame_ms ?? 1000, raining);
  const fireworks = fireworksFor(event, layer);
  const fireworksTick = useTicker(fireworks?.frame_ms ?? 1000, !!fireworks && !reduced);

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !images) return;
    drawMap(ctx, images, look, statuses, raining ? rainTick : null, event, layer, fireworks && !reduced ? fireworksTick : null, hover);
  }, [images, look, statuses, raining, rainTick, event, layer, fireworks, reduced, fireworksTick, hover]);

  const pick = (key: string) => {
    if (isOpen(statuses.get(key))) {
      setPicked(null);
      onOpen(key);
    } else setPicked(key);
  };
  const toMap = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  const tipKey = hover ?? picked;
  const tipPlace = tipKey ? PLACE.get(tipKey) : undefined;
  const tip = tipKey ? tipFor(tipKey, statuses.get(tipKey)) : null;
  const tipAt = tipPlace?.tooltip_anchor;
  const { u, layout } = useUi();
  const fz = bodyPx(u, layout);

  return (
    <div className="rio-map" ref={wrap} data-look={look} data-fit={fit.mode} data-event={event?.key} data-hover={hover ?? undefined}>
      <div className="rio-map-layer" style={{ left: fit.x, top: fit.y, width: W * scale, height: H * scale }}>
        <canvas
          ref={canvas}
          width={W}
          height={H}
          className="farm-px"
          style={{ width: W * scale, height: H * scale, cursor: hover && isOpen(statuses.get(hover)) ? "pointer" : undefined }}
          aria-hidden="true"
          onPointerMove={(e) => setHover(hitPlace(...toMap(e)))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const key = hitPlace(...toMap(e));
            if (key) pick(key);
            else setPicked(null);
          }}
        />
        {/* A small label under each place she can visit, over its foot where the map has a little room
            below; where it has none (another place right under it), the hover tooltip names it. PLACEHOLDER WORDING */}
        {RIO_MAP.places.filter((p) => isOpen(statuses.get(p.key)) && labelled(p)).map((p) => {
          const [bx, by, bw, bh] = p.bbox;
          const labelH = (FONT.lineHeight + 1) * fz;
          const room = (p.label_room?.clear_px_below ?? 10) * scale;
          return (
            <BitmapText key={p.key} text={p.name} colour={INK.cream} shadow={INK.ink} className="rio-place-label"
              style={{ left: (bx + bw / 2) * scale, top: (by + bh) * scale + Math.min(0, room - labelH) + 1 }} />
          );
        })}
        {tipPlace && tipAt && tip && (
          <Tip className="rio-tooltip" lines={[tipPlace.name, tip]} side="above" at={{ x: tipAt[0] * scale, y: tipAt[1] * scale - 2 * u }} />
        )}
      </div>
      <p className="visually-hidden" role="status">{tipPlace && !isOpen(statuses.get(tipPlace.key)) ? tip : ""}</p>
      {/* PLACEHOLDER WORDING */}
      <ul className="visually-hidden" aria-label="Places in Rio">
        {RIO_MAP.places.map((p) => {
          const s = statuses.get(p.key) ?? "locked";
          return (
            <li key={p.key}>
              <button type="button" data-place={p.key} data-status={s} aria-describedby={`rio-place-${p.key}`} onClick={() => pick(p.key)}>
                {p.name}
              </button>
              {/* PLACEHOLDER WORDING */}
              <span id={`rio-place-${p.key}`} hidden>{s === "new" ? "New" : s === "open" ? "Open" : tipFor(p.key, s)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Esme's Rio: the map. One canvas at a crisp size, covering the game's view without trimming any
// place (or, if it can't, the whole map fitted: mapMath.ts coverFit); it never scrolls. Drawn
// drawn as map.json says: the base for the look, the boat route, each place's open or locked
// layer, then the markers (the padlock on the next place, NEW until the first visit). A hidden
// list of buttons mirrors it for the keyboard and screen readers.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion, useTicker } from "../farm/hooks";
import { ctx2d } from "../farm/sprites";
import { opensOn, type AreaStatus } from "./areas";
import { MAP_DIR, RIO_MAP, mapBase, mapLayer, mapLook, type Look, type RioEvent } from "./assets";
import { activeEvent, useNow } from "./events";
import { useCover, useRioImages, type RioImages } from "./canvas";
import { MAP_KEEP, hitPlace } from "./mapMath";
import { useUi } from "./ui/fit";

const [W, H] = RIO_MAP.canvas;
const PLACE = new Map(RIO_MAP.places.map((p) => [p.key, p]));
const at = (p: string) => `${MAP_DIR}/${p}`;

const isOpen = (s: AreaStatus | undefined) => s === "open" || s === "new";
const RAIN = RIO_MAP.weather?.rain?.overlay;
/** The falling rain plays over the map's own rain look (none while the pack has no rain look). */
const rainsOn = (look: Look) => look === "rain" && mapLook(look, RIO_MAP.look_files) === "rain" && !!RAIN?.frames.length;

/** What a closed place says (PLACEHOLDER WORDING). */
function tipFor(key: string, status: AreaStatus | undefined): string | null {
  if (isOpen(status)) return null;
  // PLACEHOLDER WORDING
  if (status === "next") return `Opens on day ${opensOn(key)}`;
  // PLACEHOLDER WORDING
  return "Coming soon";
}

/** A takeover's layer for the look (on a rainy day, the day layer over the rain look). */
const eventLayer = (e: RioEvent, look: Look) => (look === "night" ? e.layers.night : e.layers.day);
const fireworksFor = (e: RioEvent | null, look: Look) => (e && look === "night" ? e.animation?.night : undefined);

function filesFor(look: Look, event: RioEvent | null): string[] {
  const out = [at(mapBase(look)), at(RIO_MAP.markers.locked.file), at(RIO_MAP.markers.new.file)];
  for (const p of [...RIO_MAP.places, RIO_MAP.boat_route]) {
    out.push(at(mapLayer(p, look, "open")), at(mapLayer(p, look, "locked")));
  }
  if (rainsOn(look)) out.push(...RAIN!.frames.map(at));
  if (event) out.push(at(eventLayer(event, look)), ...(fireworksFor(event, look)?.frames ?? []).map(at));
  return out;
}

function drawMap(ctx: CanvasRenderingContext2D, img: RioImages, look: Look, statuses: ReadonlyMap<string, AreaStatus>, rainFrame: number | null,
  event: RioEvent | null, fireworksFrame: number | null) {
  ctx.clearRect(0, 0, W, H);
  const put = (path: string, x = 0, y = 0) => {
    const i = img[at(path)];
    if (i) ctx.drawImage(i, x, y);
  };
  const markers: { file: string; at: [number, number] }[] = [];
  for (const key of RIO_MAP.draw_order) {
    if (key === "base") put(mapBase(look));
    else if (key === RIO_MAP.boat_route.key) {
      put(mapLayer(RIO_MAP.boat_route, look, isOpen(statuses.get(RIO_MAP.boat_route.links)) ? "open" : "locked"));
    } else if (key !== "markers") {
      const p = PLACE.get(key);
      if (!p) continue;
      const s = statuses.get(key);
      put(mapLayer(p, look, isOpen(s) ? "open" : "locked"));
      if (s === "next") markers.push({ file: RIO_MAP.markers.locked.file, at: p.marker_anchor });
      if (s === "new") markers.push({ file: RIO_MAP.markers.new.file, at: p.marker_anchor });
    }
  }
  // A holiday takeover: after the last place, over open and locked alike, before the rain and markers.
  if (event) {
    put(eventLayer(event, look));
    const fw = fireworksFor(event, look);
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
  const files = useMemo(() => filesFor(look, event), [look, event]);
  const images = useRioImages(files);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const raining = rainsOn(look) && !reduced;
  const rainTick = useTicker(RAIN?.frame_ms ?? 1000, raining);
  const fireworks = fireworksFor(event, look);
  const fireworksTick = useTicker(fireworks?.frame_ms ?? 1000, !!fireworks && !reduced);

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !images) return;
    drawMap(ctx, images, look, statuses, raining ? rainTick : null, event, fireworks && !reduced ? fireworksTick : null);
  }, [images, look, statuses, raining, rainTick, event, fireworks, reduced, fireworksTick]);

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

  const tipKey = hover && !isOpen(statuses.get(hover)) ? hover : picked;
  const tip = tipKey ? tipFor(tipKey, statuses.get(tipKey)) : null;
  const tipAt = tipKey ? PLACE.get(tipKey)?.tooltip_anchor : undefined;

  return (
    <div className="rio-map" ref={wrap} data-look={look} data-fit={fit.mode} data-event={event?.key}>
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
        <p className="rio-tooltip" role="status" hidden={!tip}
          style={tipAt ? { left: tipAt[0] * scale, top: tipAt[1] * scale } : undefined}>
          {tip ?? ""}
        </p>
      </div>
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

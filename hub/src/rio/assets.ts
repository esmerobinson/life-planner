// Esme's Rio: the art pack (copied into src/assets/rio by scripts/import-rio-pack.mjs), read
// through typed loaders. The pack's areas were drawn by different hands, so their slots files
// differ a little (bases nested by state and look or flat "start-day" keys; slots as a list or
// split by state; the falling rain as one strip, a frame list, or loose frames named only in the
// area's README). This file reads each one and hands the rest of the app one shape.

import rawMap from "../assets/rio/day1/map/map.json";

const URLS = import.meta.glob("../assets/rio/**/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const JSON_FILES = import.meta.glob("../assets/rio/**/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

/** The bundled URL for a pack-relative path (e.g. "day1/map/map-base-day.png"); "" if missing. */
export const rioUrl = (path: string): string => URLS[`../assets/rio/${path}`] ?? "";

const readJson = <T>(path: string): T => {
  const j = JSON_FILES[`../assets/rio/${path}`];
  if (!j) throw new Error(`The Rio pack has no ${path}`);
  return j as T;
};

export type Look = "day" | "rain" | "night";
export const LOOKS: readonly Look[] = ["day", "rain", "night"];

// ---- the map ---------------------------------------------------------------------------------

export type Rect = [number, number, number, number];
type LayerFiles = Record<"open" | "locked", string>;

export interface RioPlace {
  key: string;
  name: string;
  opens_day: number | null;
  opens?: "last";
  /** Per look: day and night always; rain once the pack adds it. */
  layers: Record<"day" | "night", LayerFiles> & Partial<Record<"rain", LayerFiles>>;
  bbox: Rect;
  hotspot: { rect: Rect; polygon: [number, number][] };
  marker_anchor: [number, number];
  tooltip_anchor: [number, number];
}

export interface RioMapData {
  canvas: [number, number];
  look_files: Record<"day" | "night", { base: string }> & Partial<Record<"rain", { base: string }>>;
  draw_order: string[];
  places: RioPlace[];
  inset: { key: string; name: string; rect: Rect; frame_rect: Rect; opens_day: number };
  boat_route: Omit<RioPlace, "opens_day" | "marker_anchor" | "tooltip_anchor"> & { opens_day: number; links: string };
  markers: Record<"locked" | "new" | "stuck" | "here", { file: string }>;
  hit_test_order: string[];
  /** The falling rain over the rain look (after the places, before the markers). */
  weather?: { rain?: { overlay: { frames: string[]; frame_ms: number } } };
}

/** map.json (paths in it are relative to day1/map/). `events` (holiday overlays) is ignored in phase 1. */
export const RIO_MAP = rawMap as unknown as RioMapData;
export const MAP_DIR = "day1/map";

/** The map draws rain from its own rain look when the pack has one; until then, from day. */
export const mapLook = (look: Look, has: object): "day" | "night" | "rain" =>
  look === "rain" && !("rain" in has) ? "day" : look;

/** A place's (or the boat route's) layer file for a look and state, map-relative. */
export const mapLayer = (p: Pick<RioPlace, "layers">, look: Look, state: "open" | "locked"): string =>
  p.layers[mapLook(look, p.layers)]![state];

/** The map's base picture for a look, map-relative. */
export const mapBase = (look: Look): string => RIO_MAP.look_files[mapLook(look, RIO_MAP.look_files)]!.base;

// ---- the scenes ------------------------------------------------------------------------------

export type SceneId =
  | "lagoa-house/outside" | "lagoa-house/living" | "lagoa-house/bedroom" | "lagoa-house/kitchen"
  | "fazenda/outside"
  | "ipanema-beach/outside" | "barraca/inside" | "ipanema-beach/sea"
  | "clothing-store/outside" | "clothing-store/inside"
  | "tijuca-park/outside" | "tijuca-park/inside"
  | "boteco/outside" | "boteco/inside";

export interface Slot {
  id: string;
  /** The sticker's foot point (bottom-centre), or its top-centre when `anchor` is "top". */
  x: number;
  y: number;
  anchor?: "top";
  /** Free only in this state (else in every state). */
  state?: string;
  /** What the slot takes (the pack's sticker tags, e.g. "hen", "pond", "fazenda:decor", "finds:*"). */
  accepts: string[];
}

export interface SceneData {
  scene: [number, number];
  /** state -> look -> pack-relative file. A look a scene doesn't have is missing (show day). */
  base: Record<string, Partial<Record<Look, string>>>;
  slots: Slot[];
  /** The falling rain, drawn over everything while the look is rain. */
  rainOverlay?: { frames?: string[]; strip?: { file: string; count: number; size: [number, number] }; ms: number };
  /** The boteco's bar TV: frames per look at `at` (the base already shows frame 0). */
  tv?: { at: [number, number]; ms: number; frames: Partial<Record<Look, string[]>> };
  overlays?: unknown;
}

interface SceneSource {
  /** The slots file, pack-relative. */
  file: string;
  /** The folder its paths are relative to (every area's slots files name paths from the area folder). */
  root: string;
  /** Rain frames the slots file doesn't name (they're in the area's README and manifest). */
  rain?: { frames: string[]; ms: number };
}

const IPANEMA_RAIN_MS = 120; // ipanema-slots.json looks.rain: "about 120 ms a frame"
const SOURCES: Record<SceneId, SceneSource> = {
  "lagoa-house/outside": { file: "day1/lagoa-house/outside/sticker-slots.json", root: "day1/lagoa-house" },
  "lagoa-house/living": { file: "day1/lagoa-house/inside/living-slots.json", root: "day1/lagoa-house" },
  "lagoa-house/bedroom": { file: "day1/lagoa-house/inside/bedroom-slots.json", root: "day1/lagoa-house" },
  "lagoa-house/kitchen": { file: "day1/lagoa-house/inside/kitchen-slots.json", root: "day1/lagoa-house" },
  "fazenda/outside": { file: "day1/fazenda/outside/sticker-slots.json", root: "day1/fazenda" },
  "ipanema-beach/outside": {
    file: "day1/ipanema/location/ipanema-slots.json", root: "day1/ipanema",
    rain: { frames: [0, 1, 2].map((i) => `overlays/rain-beach-${i}.png`), ms: IPANEMA_RAIN_MS },
  },
  "barraca/inside": {
    file: "day1/ipanema/barraca/barraca-slots.json", root: "day1/ipanema",
    rain: { frames: [0, 1, 2].map((i) => `overlays/rain-barraca-${i}.png`), ms: IPANEMA_RAIN_MS },
  },
  "ipanema-beach/sea": { file: "day1/ipanema/sea/sea-slots.json", root: "day1/ipanema" },
  "clothing-store/outside": {
    file: "day1/clothing-store/outside/outside-slots.json", root: "day1/clothing-store",
    rain: { frames: [0, 1, 2].map((i) => `outside/outside-rain-streaks-${i}.png`), ms: 110 }, // manifest.json overlays.rain
  },
  "clothing-store/inside": { file: "day1/clothing-store/inside/inside-slots.json", root: "day1/clothing-store" },
  "tijuca-park/outside": { file: "week1/tijuca-park/outside/tijuca-outside-slots.json", root: "week1/tijuca-park" },
  "tijuca-park/inside": { file: "week1/tijuca-park/inside/tijuca-inside-slots.json", root: "week1/tijuca-park" },
  "boteco/outside": { file: "later/boteco/location/outside-slots.json", root: "later/boteco" },
  "boteco/inside": { file: "later/boteco/inside/inside-slots.json", root: "later/boteco" },
};

type RawSlot = { id: string; x: number; y: number; anchor?: string; state?: string; accepts?: string[] };
interface RawStrip { file: string; json: string }
interface RawScene {
  scene: [number, number];
  base: Record<string, string | Record<string, string>>;
  slots: RawSlot[] | Record<string, RawSlot[]>;
  overlays?: {
    rain?: RawStrip | { frames: string[]; frame_ms: number };
    tv?: { at: [number, number]; frame_ms: number; frames: Record<string, string[]> };
    [k: string]: unknown;
  };
  rain_overlay?: RawStrip;
}

const isLook = (k: string): k is Look => (LOOKS as readonly string[]).includes(k);

/** Bases nested ({start: {day: …}}) or flat ({"start-day": …}), as state -> look -> file. */
function readBase(raw: RawScene["base"], at: (p: string) => string): SceneData["base"] {
  const out: SceneData["base"] = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      const i = k.lastIndexOf("-");
      const state = k.slice(0, i);
      const look = k.slice(i + 1);
      if (isLook(look)) (out[state] ??= {})[look] = at(v);
    } else {
      for (const [look, file] of Object.entries(v)) if (isLook(look)) (out[k] ??= {})[look] = at(file);
    }
  }
  return out;
}

/** Slots as a list, or split into common and per-state lists. */
function readSlots(raw: RawScene["slots"]): Slot[] {
  const tidy = (s: RawSlot, state?: string): Slot => ({
    id: s.id, x: s.x, y: s.y, accepts: s.accepts ?? [], ...(s.anchor === "top" ? { anchor: "top" as const } : {}), ...(state ?? s.state ? { state: state ?? s.state } : {}),
  });
  if (Array.isArray(raw)) return raw.map((s) => tidy(s));
  return Object.entries(raw).flatMap(([group, list]) => list.map((s) => tidy(s, group === "common" ? undefined : group)));
}

function readScene(src: SceneSource): SceneData {
  const raw = readJson<RawScene>(src.file);
  const at = (p: string) => `${src.root}/${p}`;
  const data: SceneData = { scene: raw.scene, base: readBase(raw.base, at), slots: readSlots(raw.slots), overlays: raw.overlays };
  const rain = raw.overlays?.rain ?? raw.rain_overlay;
  if (rain && "frames" in rain) data.rainOverlay = { frames: rain.frames.map(at), ms: rain.frame_ms };
  else if (rain) {
    const meta = readJson<{ frames: number; frame_size: [number, number]; ms: number }>(at(rain.json));
    data.rainOverlay = { strip: { file: at(rain.file), count: meta.frames, size: meta.frame_size }, ms: meta.ms };
  } else if (src.rain) data.rainOverlay = { frames: src.rain.frames.map(at), ms: src.rain.ms };
  const tv = raw.overlays?.tv;
  if (tv) {
    const frames: NonNullable<SceneData["tv"]>["frames"] = {};
    for (const [look, list] of Object.entries(tv.frames)) if (isLook(look)) frames[look] = list.map(at);
    data.tv = { at: tv.at, ms: tv.frame_ms, frames };
  }
  return data;
}

export const SCENES: Record<SceneId, SceneData> = Object.fromEntries(
  (Object.entries(SOURCES) as [SceneId, SceneSource][]).map(([id, src]) => [id, readScene(src)]),
) as Record<SceneId, SceneData>;

/** A scene's base for a state and look: night and day as drawn; rain falls back to day where a scene has none. */
export function sceneBase(id: SceneId, state: string, look: Look): string {
  const looks = SCENES[id].base[state] ?? Object.values(SCENES[id].base)[0]!;
  return looks[look] ?? looks.day!;
}

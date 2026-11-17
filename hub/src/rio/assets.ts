// Esme's Rio: the art pack (copied into src/assets/rio by scripts/import-rio-pack.mjs), read
// through typed loaders. The pack's areas were drawn by different hands, so their slots files
// differ a little (bases nested by state and look or flat "start-day" keys; slots as a list or
// split by state; the falling rain as one strip, a frame list, or loose frames named only in the
// area's README). This file reads each one and hands the rest of the app one shape.

import rawMap from "../assets/rio/day1/map/map.json";

const URLS = import.meta.glob("../assets/rio/**/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
// Only the JSON the app reads goes in the bundle: never the looks' palettes or the packs' manifests
// (about half a megabyte the app doesn't use), except the themed nights' manifest, which it reads.
const JSON_FILES = {
  ...import.meta.glob(["../assets/rio/**/*.json", "!**/palette*.json", "!**/manifest.json"], { eager: true, import: "default" }),
  ...import.meta.glob("../assets/rio/later/boteco/themed-nights/manifest.json", { eager: true, import: "default" }),
} as Record<string, unknown>;

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
  /** Free map pixels below the place for its small label (the bigger map, 2026-11-17). */
  label_room?: { clear_px_below: number };
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
  /** Holiday takeovers (Carnaval, Réveillon): dates "MM-DD" in Rio, a layer per look, map-relative. */
  events: RioEvent[];
}

export interface RioEvent {
  key: string;
  name: string;
  dates: { from: string; to: string; night_runs_until?: string };
  layers: Record<"day" | "night", string>;
  animation?: { night: { frames: string[]; frame_ms: number } };
}

/** map.json (paths in it are relative to day1/map/). */
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
  | "boteco/outside" | "boteco/inside"
  // Phase 2a: the areas drawn since phase 1.
  | "zona-sul/outside" | "zona-sul/inside"
  | "jardim-botanico/outside" | "jardim-botanico/inside"
  | "quilo/outside" | "quilo/inside"
  | "sult/outside" | "sult/inside"
  | "os-esquilos/outside" | "os-esquilos/inside"
  | "santa-teresa/outside" | "santa-teresa/inside"
  | "museum/outside" | "museum/inside"
  | "flamengo-match/outside" | "flamengo-match/inside";

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
  /** Fill order (lowest first) where the pack gives one; such slots come first. */
  order?: number;
  /** Free only once this milestone is earned (Santa Teresa's window seat and second bookcase). */
  requires?: string;
}

/** A sheet the app copies small pictures from (Santa Teresa's book spines and framed covers). */
export interface Sheet {
  /** Per look, pack-relative. */
  sheets: Partial<Record<Look, string>>;
  /** Slot n = book n: copy the sheet's (sx, sy, w, h) to (x, y). */
  slots: { n: number; x: number; y: number; w: number; h: number; sx: number; sy: number; requires?: string }[];
}

export interface SceneData {
  scene: [number, number];
  /** state -> look -> pack-relative file. A look a scene doesn't have is missing (show day). */
  base: Record<string, Partial<Record<Look, string>>>;
  slots: Slot[];
  /** The falling rain, drawn over everything while the look is rain. */
  rainOverlay?: { frames?: string[]; strip?: { file: string; count: number; size: [number, number] }; ms: number };
  /** Esme herself, drawn by the app (the sea: snorkelling by the board): a strip per look at `at` − `offset`, over the stickers. */
  player?: { files: Partial<Record<Look, string>>; at: [number, number]; offset: [number, number]; size: [number, number]; count: number; ms: number };
  /** The match's goal moment: whole frames per look (frame 0 is the full base). */
  goal?: { frames: Partial<Record<Look, string[]>>; ms: number };
  /** Small pictures stamped on the base in a look (the museum's open doors by day). */
  stamps?: Partial<Record<Look, { file: string; at: [number, number] }[]>>;
  /** Glass drawn over the placed stickers (the museum's case glints). */
  glass?: { file: string; at: [number, number][] };
  /** Placed stickers (and the glass) take the look's colours (tint.ts), as the museum's README asks. */
  tint?: boolean;
  /** Under the stickers, over the base: a strip per state and look (the sea's caustics). */
  underlay?: { strips: Record<string, Partial<Record<Look, string>>>; count: number; size: [number, number]; ms: number };
  /** The boteco's bar TV: frames per look at `at` (the base already shows frame 0). */
  tv?: { at: [number, number]; ms: number; frames: Partial<Record<Look, string[]>> };
  /** Os Esquilos: one layer per whole goal finished, in step order, drawn over the start base. */
  celebrations?: { id: string; layers: Partial<Record<Look, string>> }[];
  /** Santa Teresa: milestone overlays (by their order), drawn over the start base. */
  milestones?: { id: string; overlay: Partial<Record<Look, string>> }[];
  /** Santa Teresa: the book spines and framed covers that fill its shelves. */
  books?: { spines: Sheet; covers: Sheet };
  overlays?: unknown;
  /**
   * The pack's doors, exits and stairs (and the noticeboard), as drawn: a rect, where it goes
   * (`to`, as the pack writes it: "map", "inside", "outside", a scene…) or what it opens, and its
   * label. Read in rio/doors.ts.
   */
  doors?: RawDoor[];
}

export interface RawDoor { id: string; rect: Rect; to?: string; opens?: string; label?: string }

/** The pack's hotspots that are doors (a `rect` and a `to` or `opens`, not retired), from a list or keyed by id. */
function readDoors(raw: unknown): RawDoor[] {
  if (typeof raw !== "object" || raw === null) return [];
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((v) => [String((v as { id?: unknown })?.id ?? ""), v])
    : Object.entries(raw);
  const out: RawDoor[] = [];
  for (const [key, v] of entries) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const d = v as Record<string, unknown>;
    if (d.retired === true) continue;
    const rect = d.rect;
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === "number")) continue;
    if (typeof d.to !== "string" && typeof d.opens !== "string") continue;
    out.push({
      id: typeof d.id === "string" ? d.id : key, rect: rect as Rect,
      ...(typeof d.to === "string" ? { to: d.to } : {}), ...(typeof d.opens === "string" ? { opens: d.opens } : {}),
      ...(typeof d.label === "string" ? { label: d.label } : {}),
    });
  }
  return out;
}

interface SceneSource {
  /** The slots file, pack-relative. */
  file: string;
  /** The folder its paths are relative to (every area's slots files name paths from the area folder). */
  root: string;
  /** Rain frames the slots file doesn't name (they're in the area's README and manifest). */
  rain?: { frames: string[]; ms: number };
  /** A separate overlays file (root-relative) with the rain and caustics strips (the sea off Arpoador). */
  overlays?: string;
}

const IPANEMA_RAIN_MS = 120; // ipanema-slots.json looks.rain: "about 120 ms a frame"
const SOURCES: Record<Exclude<SceneId, "museum/outside" | "museum/inside">, SceneSource> = {
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
  // The finished sea (2026-11-17) replaces the rough first one in day1/ipanema/sea/ (left bundled, unread).
  "ipanema-beach/sea": { file: "later/arpoador-sea/scenes/arpoador-sea-slots.json", root: "later/arpoador-sea", overlays: "overlays/arpoador-overlays.json" },
  "clothing-store/outside": {
    file: "day1/clothing-store/outside/outside-slots.json", root: "day1/clothing-store",
    rain: { frames: [0, 1, 2].map((i) => `outside/outside-rain-streaks-${i}.png`), ms: 110 }, // manifest.json overlays.rain
  },
  "clothing-store/inside": { file: "day1/clothing-store/inside/inside-slots.json", root: "day1/clothing-store" },
  "tijuca-park/outside": { file: "week1/tijuca-park/outside/tijuca-outside-slots.json", root: "week1/tijuca-park" },
  "tijuca-park/inside": { file: "week1/tijuca-park/inside/tijuca-inside-slots.json", root: "week1/tijuca-park" },
  "boteco/outside": { file: "later/boteco/location/outside-slots.json", root: "later/boteco" },
  "boteco/inside": { file: "later/boteco/inside/inside-slots.json", root: "later/boteco" },
  "zona-sul/outside": { file: "week2/zona-sul/outside/outside-slots.json", root: "week2/zona-sul" },
  "zona-sul/inside": { file: "week2/zona-sul/inside/inside-slots.json", root: "week2/zona-sul" },
  "jardim-botanico/outside": { file: "week2/jardim-botanico/outside/jardim-outside-slots.json", root: "week2/jardim-botanico" },
  "jardim-botanico/inside": { file: "week2/jardim-botanico/inside/jardim-inside-slots.json", root: "week2/jardim-botanico" },
  "quilo/outside": { file: "later/quilo/outside/outside-slots.json", root: "later/quilo" },
  "quilo/inside": { file: "later/quilo/inside/inside-slots.json", root: "later/quilo" },
  "sult/outside": { file: "later/sult/outside/outside-slots.json", root: "later/sult" },
  "sult/inside": { file: "later/sult/inside/inside-slots.json", root: "later/sult" },
  "os-esquilos/outside": { file: "later/os-esquilos/outside/os-esquilos-outside-slots.json", root: "later/os-esquilos" },
  "os-esquilos/inside": { file: "later/os-esquilos/inside/os-esquilos-inside-slots.json", root: "later/os-esquilos" },
  "santa-teresa/outside": { file: "later/santa-teresa/outside/outside-slots.json", root: "later/santa-teresa" },
  "santa-teresa/inside": { file: "later/santa-teresa/inside/inside-slots.json", root: "later/santa-teresa" },
  "flamengo-match/outside": { file: "later/flamengo/outside/outside-slots.json", root: "later/flamengo" },
  "flamengo-match/inside": { file: "later/flamengo/inside/inside-slots.json", root: "later/flamengo" },
};

type RawSlot = { id: string; x: number; y: number; anchor?: string; state?: string; accepts?: string[]; order?: number; requires?: string };
type RawLooks = Partial<Record<string, string>>;
interface RawSheet { sheets: RawLooks; slots: { n: number; x: number; y: number; w: number; h: number; sheet: [number, number]; requires?: string }[] }
interface RawStrip { file: string; json: string }
interface RawScene {
  scene: [number, number];
  base: Record<string, string | Record<string, string>>;
  /** Some areas name their sticker slots `sticker_slots` (beside dish and ingredient slots, phase 2b). */
  slots?: RawSlot[] | Record<string, RawSlot[]>;
  sticker_slots?: RawSlot[];
  celebrations?: { step: number; id: string; layers: RawLooks }[];
  milestones?: { id: string; order: number; overlay: RawLooks }[];
  player?: { anchor: { x: number; y: number }; json: string };
  animations?: { goal?: { frames: Record<string, string[]>; frame_ms: number } };
  shelf_slots?: RawSheet;
  cover_slots?: RawSheet;
  hotspots?: unknown;
  /** The Lagoa house's doors (2026-11-17 redraw): read before its hotspots. */
  doors?: unknown;
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

/** Slots as a list, or split into common and per-state lists; slots with an `order` first, by it. */
function readSlots(raw: NonNullable<RawScene["slots"]>): Slot[] {
  const tidy = (s: RawSlot, state?: string): Slot => ({
    id: s.id, x: s.x, y: s.y, accepts: s.accepts ?? [], ...(s.anchor === "top" ? { anchor: "top" as const } : {}), ...(state ?? s.state ? { state: state ?? s.state } : {}),
    ...(typeof s.order === "number" ? { order: s.order } : {}), ...(s.requires ? { requires: s.requires } : {}),
  });
  const list = Array.isArray(raw) ? raw.map((s) => tidy(s)) : Object.entries(raw).flatMap(([group, l]) => l.map((s) => tidy(s, group === "common" ? undefined : group)));
  const ordered = list.filter((s) => s.order !== undefined).sort((a, b) => a.order! - b.order!);
  return [...ordered, ...list.filter((s) => s.order === undefined)];
}

/** A per-look file map, pack-relative. */
function readLooks(raw: RawLooks, at: (p: string) => string): Partial<Record<Look, string>> {
  const out: Partial<Record<Look, string>> = {};
  for (const [look, file] of Object.entries(raw)) if (isLook(look) && file) out[look] = at(file);
  return out;
}

const readSheet = (raw: RawSheet, at: (p: string) => string): Sheet => ({
  sheets: readLooks(raw.sheets, at),
  slots: raw.slots.map((s) => ({ n: s.n, x: s.x, y: s.y, w: s.w, h: s.h, sx: s.sheet[0], sy: s.sheet[1], ...(s.requires ? { requires: s.requires } : {}) })),
});

function readScene(src: SceneSource): SceneData {
  const raw = readJson<RawScene>(src.file);
  const at = (p: string) => `${src.root}/${p}`;
  const data: SceneData = { scene: raw.scene, base: readBase(raw.base, at), slots: readSlots(raw.slots ?? raw.sticker_slots ?? []), overlays: raw.overlays };
  const own = readDoors(raw.doors);
  const doors = own.length ? own : readDoors(raw.hotspots);
  if (doors.length) data.doors = doors;
  if (raw.celebrations) {
    data.celebrations = [...raw.celebrations].sort((a, b) => a.step - b.step).map((c) => ({ id: c.id, layers: readLooks(c.layers, at) }));
  }
  if (raw.milestones) {
    data.milestones = [...raw.milestones].sort((a, b) => a.order - b.order).map((m) => ({ id: m.id, overlay: readLooks(m.overlay, at) }));
  }
  if (raw.shelf_slots && raw.cover_slots) data.books = { spines: readSheet(raw.shelf_slots, at), covers: readSheet(raw.cover_slots, at) };
  const rain = raw.overlays?.rain ?? raw.rain_overlay;
  if (rain && "frames" in rain) data.rainOverlay = { frames: rain.frames.map(at), ms: rain.frame_ms };
  else if (rain) {
    const meta = readJson<{ frames: number; frame_size: [number, number]; ms: number }>(at(rain.json));
    data.rainOverlay = { strip: { file: at(rain.file), count: meta.frames, size: meta.frame_size }, ms: meta.ms };
  } else if (src.rain) data.rainOverlay = { frames: src.rain.frames.map(at), ms: src.rain.ms };
  const goal = raw.animations?.goal;
  if (goal) {
    const frames: Partial<Record<Look, string[]>> = {};
    for (const [look, list] of Object.entries(goal.frames)) if (isLook(look)) frames[look] = list.map(at);
    data.goal = { frames, ms: goal.frame_ms };
  }
  if (raw.player) {
    const j = readJson<{ frames: number; ms: number; frame_size: [number, number]; anchor: [number, number]; files: RawLooks }>(at(raw.player.json));
    data.player = { files: readLooks(j.files, at), at: [raw.player.anchor.x, raw.player.anchor.y], offset: j.anchor, size: j.frame_size, count: j.frames, ms: j.ms };
  }
  if (src.overlays) {
    type Strip = { frames: number; frame_size: [number, number]; ms: number };
    const o = readJson<{ caustics?: Strip & { files: Record<string, RawLooks> }; rain?: Strip & { file: string } }>(at(src.overlays));
    if (o.caustics) {
      const strips: Record<string, Partial<Record<Look, string>>> = {};
      for (const [state, looks] of Object.entries(o.caustics.files)) strips[state] = readLooks(looks, at);
      data.underlay = { strips, count: o.caustics.frames, size: o.caustics.frame_size, ms: o.caustics.ms };
    }
    if (o.rain) data.rainOverlay = { strip: { file: at(o.rain.file), count: o.rain.frames, size: o.rain.frame_size }, ms: o.rain.ms };
  }
  const tv = raw.overlays?.tv;
  if (tv) {
    const frames: NonNullable<SceneData["tv"]>["frames"] = {};
    for (const [look, list] of Object.entries(tv.frames)) if (isLook(look)) frames[look] = list.map(at);
    data.tv = { at: tv.at, ms: tv.frame_ms, frames };
  }
  return data;
}

// ---- the museum: day from the esme pack (summer is the Rio day), night and rain from week3 ----

const MUSEUM_DAY = "esme-pack/week2-4/museum";
const MUSEUM_LOOKS = "week3/museum-looks";
type RawStreaks = { file: string; frame: [number, number]; frames: number; frame_ms: number };
const streaks = (name: "plaza" | "hall"): SceneData["rainOverlay"] => {
  const j = readJson<RawStreaks>(`${MUSEUM_LOOKS}/rain/${name}-rain-streaks.json`);
  return { strip: { file: `${MUSEUM_LOOKS}/${j.file}`, count: j.frames, size: j.frame }, ms: j.frame_ms };
};

function museumOutside(): SceneData {
  const raw = readJson<{ scene: [number, number]; states: { open: { stamps: { file: string; x: number; y: number }[] } }; slots: RawSlot[] }>(
    `${MUSEUM_DAY}/location/plaza-slots.json`);
  return {
    scene: raw.scene,
    // She only reaches the plaza once it's open: the doors stand open.
    base: { open: { day: `${MUSEUM_DAY}/location/plaza-summer.png`, night: `${MUSEUM_LOOKS}/location/plaza-summer-open-night.png`, rain: `${MUSEUM_LOOKS}/location/plaza-summer-open-rain.png` } },
    stamps: { day: raw.states.open.stamps.map((st) => ({ file: `${MUSEUM_DAY}/${st.file}`, at: [st.x, st.y] as [number, number] })) },
    slots: readSlots(raw.slots),
    rainOverlay: streaks("plaza"),
    tint: true,
  };
}

function museumInside(): SceneData {
  const raw = readJson<{ size_px: [number, number]; display_slots: { id: string; foot: [number, number]; accepts: string[] }[]; case_glass: { file: string; at: [number, number][] } }>(
    `${MUSEUM_DAY}/inside/room-hall.json`);
  return {
    scene: raw.size_px,
    base: { start: { day: `${MUSEUM_DAY}/inside/hall-summer.png`, night: `${MUSEUM_LOOKS}/inside/hall-summer-night.png`, rain: `${MUSEUM_LOOKS}/inside/hall-summer-rain.png` } },
    slots: raw.display_slots.map((d) => ({ id: d.id, x: d.foot[0], y: d.foot[1], accepts: d.accepts })),
    glass: { file: `${MUSEUM_DAY}/${raw.case_glass.file}`, at: raw.case_glass.at },
    rainOverlay: streaks("hall"),
    tint: true,
  };
}

export const SCENES: Record<SceneId, SceneData> = {
  ...(Object.fromEntries((Object.entries(SOURCES) as [SceneId, SceneSource][]).map(([id, src]) => [id, readScene(src)])) as Record<SceneId, SceneData>),
  "museum/outside": museumOutside(),
  "museum/inside": museumInside(),
};

/** A scene's base for a state and look: night and day as drawn; rain falls back to day where a scene has none. */
export function sceneBase(id: SceneId, state: string, look: Look): string {
  const looks = SCENES[id].base[state] ?? Object.values(SCENES[id].base)[0]!;
  return looks[look] ?? looks.day!;
}

// ---- the boteco's themed nights (bundled; nothing triggers them until phase 2b's bundles) ---------

export type BotecoNight = "samba" | "karaoke" | "funk" | "football";
export const BOTECO_NIGHT_KEYS: readonly BotecoNight[] = ["samba", "karaoke", "funk", "football"];

export interface NightLayer {
  /** Full-scene overlay at (0, 0) over the full night base, pack-relative. */
  overlay: string;
  /** The base's own bar TV plays under it (every night but football). */
  baseTv: boolean;
  /** Strips: frame k at `at`; `once` plays once when the scene opens (the karaoke screen coming down). */
  anims: { strip: string; at: [number, number]; size: [number, number]; frames: number; ms: number; once: boolean }[];
}

interface RawNightSide {
  overlay: string;
  base_tv: boolean;
  anims: { strip: string; play: string; at: [number, number]; frame_size: [number, number]; frames: number; frame_ms: number }[];
}
const NIGHTS_DIR = "later/boteco/themed-nights";
const rawNights = readJson<{ nights: Record<BotecoNight, { inside: RawNightSide; outside: RawNightSide; poster: { file: string } }> }>(`${NIGHTS_DIR}/manifest.json`).nights;
const nightAt = (p: string) => `${NIGHTS_DIR}/${p}`;
const readNightSide = (r: RawNightSide): NightLayer => ({
  overlay: nightAt(r.overlay),
  baseTv: r.base_tv,
  anims: r.anims.map((a) => ({ strip: nightAt(a.strip), at: a.at, size: a.frame_size, frames: a.frames, ms: a.frame_ms, once: a.play.startsWith("once") })),
});

/** The four themed nights (the pack's manifest), pack-relative. */
export const BOTECO_NIGHTS: Record<BotecoNight, { inside: NightLayer; outside: NightLayer; poster: string }> = Object.fromEntries(
  BOTECO_NIGHT_KEYS.map((k) => [k, { inside: readNightSide(rawNights[k].inside), outside: readNightSide(rawNights[k].outside), poster: nightAt(rawNights[k].poster.file) }]),
) as Record<BotecoNight, { inside: NightLayer; outside: NightLayer; poster: string }>;

// Esme's Farm: the farm's rules (pure). Characters arrive at sticker totals, host the nook on
// their pages, wear accessories they've unlocked; zones wake as their stickers are earned;
// beds grow by to-dos; placed stickers sit at their one fixed spot. Values come from the art
// pack's manifest and game design v2; anything that is a guess is marked PLACEHOLDER.

import { tickedOffToday, todayList } from "../domain/triage";
import type { Goal, ISODate, Item } from "../domain/types";
import { GROUPS, MANIFEST, STICKERS, STICKER_BY_KEY, asset, stickersIn, type BookPage } from "./catalogue";
import type { Counters } from "./earning";
import { CHARACTERS, type CharacterId } from "./state";

// ---- characters ----------------------------------------------------------------------------

export const NAMES: Record<CharacterId, string> = {
  domino: "Domino", bap: "Bap", puddle: "Puddle", clover: "Clover", crumpet: "Crumpet", duvet: "Duvet",
};

/** Sticker totals at which each character moves in (manifest `arrivals`: 0, 5, 20, 45, 80, 120). */
export const ARRIVES_AT: Record<CharacterId, number> = Object.fromEntries(
  CHARACTERS.map((c) => [c, MANIFEST.arrivals.find((a) => a.character.toLowerCase() === c)!.at_stickers]),
) as Record<CharacterId, number>;

/** Who lives here at a sticker total, in arrival order (Domino from day one). */
export const arrivedAt = (total: number): CharacterId[] => CHARACTERS.filter((c) => total >= ARRIVES_AT[c]);

/** Each zone's keeper (game design v2, section 1 and 6). */
export const KEEPER: Record<string, CharacterId> = {
  beds: "domino", orchard: "domino", meadow: "puddle", lane: "puddle", barnyard: "crumpet", farmhouse: "crumpet",
  glasshouse: "clover", pond: "bap", aquarium: "bap", museum: "duvet",
};

/** Where a host could appear: the page being shown. */
export interface HostPlace {
  path: string;
  /** On the farm page: the zones of the open book spread (none: the book is closed or on contents). */
  farmZones?: readonly string[];
}

/**
 * The character in the nook (one on screen at a time). Domino everywhere, unless the page has a
 * host who has arrived: Journal -> Bap (Morning pages -> Clover); the sticker book -> Puddle;
 * the farm -> the open page's zone keeper. Reviews (Crumpet) and the reading list (Duvet) host
 * once those pages exist.
 */
export function nookHost(place: HostPlace, arrived: ReadonlySet<CharacterId>): CharacterId {
  const first = (...who: CharacterId[]) => who.find((c) => arrived.has(c)) ?? "domino";
  const path = place.path;
  if (path.startsWith("/journal/morning")) return first("clover", "bap");
  if (path === "/journal" || path.startsWith("/journal/")) return first("bap");
  if (path === "/farm" || path.startsWith("/farm/")) {
    const zones = place.farmZones ?? [];
    if (zones.length === 0) return first("puddle");
    return first(...zones.map((z) => KEEPER[z]!).filter((c) => c !== "domino"), "domino");
  }
  return "domino";
}

/**
 * PLACEHOLDER (Esme sets these): the local hours the nook character sleeps ("at night, local
 * evening/late"), from NIGHT_FROM to NIGHT_UNTIL.
 */
export const NIGHT_FROM = 22;
export const NIGHT_UNTIL = 6;

/** Asleep at night, and while she's writing Morning pages. */
export const sleeping = (hour: number, writingMorningPages: boolean): boolean =>
  writingMorningPages || hour >= NIGHT_FROM || hour < NIGHT_UNTIL;

// ---- accessories ---------------------------------------------------------------------------

export interface Accessory { code: string; name: string; unlock: string; frame: number }

/** The 18 accessories (the same codes fit every character: acc-<character>). */
export const ACCESSORIES: readonly Accessory[] = (asset("acc-domino") as unknown as { items: Omit<Accessory, "frame">[] }).items.map(
  (it, frame) => ({ ...it, frame }),
);

const SEASONS: Record<string, number[]> = { spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] };
const MONTH_KEYS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Accessories unlocked (cosmetic only): A1–A7 at sticker totals (5/15/30/45/60/80/100);
 * seasonal ones once she has been active in that season (then for good); host items once that
 * host's zone is awake. "Rainy days" (A11) waits for weather, which isn't built.
 */
export function unlockedAccessories(total: number, awake: ReadonlySet<string>, c: Counters | null): string[] {
  const activeMonths = new Set(MONTH_KEYS.flatMap((m, i) => ((c?.get(`month:${m}`) ?? 0) > 0 ? [i + 1] : [])));
  return ACCESSORIES.filter((a) => {
    const n = /^(\d+) stickers$/.exec(a.unlock);
    if (n) return total >= Number(n[1]);
    const season = SEASONS[a.unlock];
    if (season) return season.some((m) => activeMonths.has(m));
    const host = /^host: (\w+)/.exec(a.unlock);
    if (host) return awake.has(host[1]!);
    return false;
  }).map((a) => a.code);
}

// ---- zones, beds -----------------------------------------------------------------------------

/** A zone wakes when about half its stickers are earned (manifest wake_rule, phase 1). */
export const wakeAt = (zone: string): number => Math.ceil(stickersIn(zone).length / 2);

export function awakeZones(earned: readonly string[]): Set<string> {
  const have = new Set(earned);
  return new Set(GROUPS.filter((z) => stickersIn(z).filter((s) => have.has(s.key)).length >= wakeAt(z)));
}

const BEDS = asset("farm-beds") as unknown as { order: string[]; stage_at: number[]; bed_positions: Record<string, [number, number]> };
export const BED_ORDER = BEDS.order;
export const BED_POSITIONS = BEDS.bed_positions;

/** A bed's stage, 0 (bare) to 5 (full), by to-dos in its area (1/5/10/25/50). */
export const bedStage = (todos: number): number => BEDS.stage_at.filter((at) => todos >= at).length;

// ---- the book's spreads -----------------------------------------------------------------------

export const PAGES: readonly BookPage[] = (asset("book-pages") as unknown as { pages: BookPage[] }).pages;

export interface Spread { index: number; pages: [BookPage | null, BookPage | null]; zones: string[] }

/** Spread 0: endpaper + contents; then pages 1–2, 3–4, …, 13–14. */
export const SPREADS: readonly Spread[] = [
  { index: 0, pages: [null, null], zones: [] },
  ...Array.from({ length: PAGES.length / 2 }, (_, i) => {
    const l = PAGES[2 * i]!;
    const r = PAGES[2 * i + 1]!;
    return { index: i + 1, pages: [l, r] as [BookPage, BookPage], zones: [...new Set([l.group, r.group])] };
  }),
];

/** The spread showing a zone's first page (where a tap on that zone opens the book). */
export const spreadOf = (zone: string): number => SPREADS.findIndex((s) => s.zones.includes(zone));

/** The spread that holds a sticker's slot. */
export const spreadOfSticker = (key: string): number =>
  SPREADS.findIndex((s) => s.pages.some((p) => p?.slots.some((sl) => sl.sticker === key)));

// ---- fixed spots on the farm ------------------------------------------------------------------

/** The sprite designer's own spots (pxland4.py BARNYARD), top-left of the 16x16 sticker. */
const DESIGNED_SPOTS: Record<string, [number, number]> = {
  hen: [254, 40], "egg-nest": [270, 50], chick: [284, 42], piglet: [296, 30], cow: [238, 48],
  "milk-churn": [304, 50], sheep: [282, 26], lamb: [268, 28],
};

export interface Spot { x: number; y: number; placeholder: boolean }

const BBOXES = (asset("farm-zone-masks") as unknown as { bboxes: Record<string, [number, number, number, number]> }).bboxes;

/**
 * PLACEHOLDER SPOTS: the art pack has no per-sticker farm positions (only the barnyard animals,
 * from the sprite designer). Until they're drawn, each other sticker gets a spot on a grid
 * inside its zone's ellipse (from the zone's box), in book order. They may overlap; the farm
 * marks them with a magenta dot so they read as unfinished.
 */
function placeholderSpots(zone: string, n: number): [number, number][] {
  const [x0, y0, x1, y1] = BBOXES[zone]!;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 - 4;
  const ry = (y1 - y0) / 2 - 4;
  for (let step = 16; step >= 2; step--) {
    const pts: [number, number][] = [];
    for (let y = y0 + 4; y <= y1 - 4; y += step) {
      for (let x = x0 + 4; x <= x1 - 4; x += step) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) pts.push([Math.round(x) - 8, Math.round(y) - 8]);
      }
    }
    if (pts.length >= n) return pts.slice(0, n);
  }
  return Array.from({ length: n }, () => [Math.round(cx) - 8, Math.round(cy) - 8]);
}

export const SPOTS: ReadonlyMap<string, Spot> = (() => {
  const out = new Map<string, Spot>();
  for (const zone of GROUPS) {
    const mine = stickersIn(zone);
    const open = mine.filter((s) => !DESIGNED_SPOTS[s.key]);
    const pts = placeholderSpots(zone, open.length);
    open.forEach((s, i) => out.set(s.key, { x: pts[i]![0], y: pts[i]![1], placeholder: true }));
    for (const s of mine) {
      const d = DESIGNED_SPOTS[s.key];
      if (d) out.set(s.key, { x: d[0], y: d[1], placeholder: false });
    }
  }
  return out;
})();

/** A sticker's spot id (each sticker has exactly one fixed spot: its own key). */
export const spotIdOf = (key: string): string => key;

// ---- the earned moment queue ---------------------------------------------------------------

/**
 * Stickers whose earned moment hasn't played yet, one at a time in book order. Journal stickers
 * wait while she is on the Journal pages (they arrive after she leaves).
 */
export function momentQueue(derived: readonly string[], seen: ReadonlySet<string>, placed: ReadonlyMap<string, string>, onJournal: boolean): string[] {
  return derived.filter((k) => !seen.has(k) && !placed.has(k) && !(onJournal && STICKER_BY_KEY.get(k)?.journal));
}

/** Book order index (for sorting). */
export const bookIndex = (key: string): number => STICKER_BY_KEY.get(key)?.index ?? STICKERS.length;

// ---- Today's list finished -------------------------------------------------------------------

/**
 * The items as they stood at the start of the day: today's ticks undone (a to-do done today is
 * open, a habit's or a project's session today is taken off). The rows are never changed.
 */
export function atDayStart(items: readonly Item[], today: ISODate): Item[] {
  return items.map((it) => {
    let out = it;
    if (it.doneDates?.includes(today)) out = { ...out, doneDates: it.doneDates.filter((d) => d !== today) };
    if (it.sessions?.some((s) => s.doneOn === today)) {
      out = { ...out, sessions: it.sessions.map((s) => (s.doneOn === today ? { ...s, doneOn: undefined } : s)) };
    }
    if (it.status === "done" && it.completedAt === today) {
      const { completedAt: _c, ...rest } = out;
      out = { ...rest, status: "open" };
    }
    return out;
  });
}

/**
 * Today's list is finished (review C1): every item on the list as Home showed it at the start
 * of the day (before today's ticks) is ticked off. Home refills its picks from the backlog as
 * she ticks, so the live list would almost never be empty; the morning's list is what counts.
 */
export function todayListFinished(items: Item[], goals: Goal[], today: ISODate): boolean {
  const morning = todayList(atDayStart(items, today), goals, today);
  const listed = [...morning.rhythm, ...morning.picks];
  if (listed.length === 0) return false;
  const now = new Map(items.map((it) => [it.id, it]));
  return listed.every((it) => {
    const current = now.get(it.id);
    return current !== undefined && tickedOffToday(current, today);
  });
}

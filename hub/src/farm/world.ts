// Esme's Farm: the farm's rules (pure). Characters arrive at sticker totals, host the nook on
// their pages, wear accessories they've unlocked; zones wake as their stickers are earned;
// beds grow by to-dos; placed stickers sit at their one fixed spot. Values come from the art
// pack's manifest and game design v2; anything that is a guess is marked PLACEHOLDER.

import { daysBetween } from "../domain/dates";
import { tickedOffToday, todayList } from "../domain/triage";
import type { Goal, ISODate, Item } from "../domain/types";
import rawSpots from "../assets/farm/sticker-spots.json";
import { COLLECTION, GROUPS, MANIFEST, REPEATS, STICKERS, STICKER_BY_KEY, asset, stickersIn, type BookPage } from "./catalogue";
import { CHARACTERS, type CharacterId } from "./state";

// ---- characters ----------------------------------------------------------------------------

export const NAMES: Record<CharacterId, string> = {
  domino: "Domino", bap: "Bap", puddle: "Puddle", clover: "Clover", crumpet: "Crumpet", duvet: "Duvet",
};

/**
 * When each character moves in (manifest `arrivals`: 0, 5, 20, 45, 80, 120): at that many
 * stickers, or on that day of the farm, whichever comes first (Esme, 2026-11-04).
 */
export const ARRIVES_AT: Record<CharacterId, number> = Object.fromEntries(
  CHARACTERS.map((c) => [c, MANIFEST.arrivals.find((a) => a.character.toLowerCase() === c)!.at_stickers]),
) as Record<CharacterId, number>;

/** The farm's day: its start is day 1, then calendar days (not days active). */
export const farmDay = (start: ISODate, today: ISODate): number => daysBetween(start, today) + 1;

/**
 * Who lives here, in arrival order (Domino from day one): each friend arrives at N stickers or on
 * day N of the farm, whichever comes first, so Duvet is always there by day 120.
 */
export const arrivedAt = (stickers: number, day: number): CharacterId[] =>
  CHARACTERS.filter((c) => stickers >= ARRIVES_AT[c] || day >= ARRIVES_AT[c]);

/**
 * The sticker totals (Esme, 2026-11-04). `collected`: of the 175 (the book's "N OF 175" and the
 * crown). `friends`: what friends' arrivals and the hats count, the 175 plus each bonus "Area
 * cleared" sticker once (its ×N repeats add nothing).
 */
export function stickerTotals(earned: ReadonlySet<string>): { collected: number; friends: number } {
  const collected = COLLECTION.filter((s) => earned.has(s.key)).length;
  return { collected, friends: collected + STICKERS.filter((s) => s.bonus && earned.has(s.key)).length };
}

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

/** The "Welcome back" Kind note (the first return after 3+ days away): it brings the wellies. */
const WELCOME_BACK = STICKERS.find((s) => s.rule.source === "returns" && s.rule.at === 1)!.key;

/**
 * The 20 accessories (the same codes fit every character: acc-<character>). Esme, 2026-11-04:
 * the crown (A13) means the whole collection, so it unlocks at all 175, not the pack's 170; the
 * wellies (A11) come with the Welcome back sticker, not rainy days (there's no weather).
 */
export const ACCESSORIES: readonly Accessory[] = (asset("acc-domino") as unknown as { items: Omit<Accessory, "frame">[] }).items.map(
  (it, frame) =>
    it.code === "A13" ? { ...it, unlock: `${COLLECTION.length} stickers (the whole collection)`, frame }
    : it.code === "A11" ? { ...it, unlock: "the Welcome back sticker", frame }
    : { ...it, frame },
);

const SEASONS: Record<string, number[]> = { spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] };
const MONTH_KEYS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Accessories unlocked (cosmetic only): A1–A7 and A12 at sticker totals (5/15/30/45/60/80/100/130,
 * counting `friends`: bonus stickers once each); the crown (A13) with every one of the 175;
 * seasonal ones once she has been active in that season (then for good); the wellies (A11) with
 * the Welcome back sticker; host items once that host's zone is awake. Never put on for her.
 */
export function unlockedAccessories(total: number, awake: ReadonlySet<string>, earned: ReadonlySet<string>): string[] {
  // Seasons from the EARNED Hedgerow stickers (kept for good), never from live counts (review I3).
  const activeMonths = new Set(
    MONTH_KEYS.flatMap((m, i) => (STICKERS.some((s) => s.rule.source === `month:${m}` && earned.has(s.key)) ? [i + 1] : [])),
  );
  return ACCESSORIES.filter((a) => {
    if (a.code === "A13") return COLLECTION.every((s) => earned.has(s.key));
    if (a.code === "A11") return earned.has(WELCOME_BACK);
    const n = /^(\d+) stickers\b/.exec(a.unlock);
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
/** To-dos at which a bed grows a stage (1/5/10/25/40; the last moved from 50, Esme 2026-11-04). */
export const BED_STAGE_AT: readonly number[] = BEDS.stage_at;
export const BED_POSITIONS = BEDS.bed_positions;

/** A bed's stage, 0 (bare) to 5 (full), by to-dos in its area (1/5/10/25/40). */
export const bedStage = (todos: number): number => BEDS.stage_at.filter((at) => todos >= at).length;

/**
 * A bed's stage from its EARNED stickers (review I3): the stage thresholds 1/5/10/25/40 are the
 * bed's sticker milestones, and earned stickers are kept for good, so a bed never shrinks when a
 * to-do is unticked or binned.
 */
export function bedStageEarned(area: string, earned: ReadonlySet<string>): number {
  const bed = STICKERS.filter((s) => s.rule.source === `todos:${area.toLowerCase()}`);
  return BEDS.stage_at.filter((at) => bed.some((s) => s.rule.at === at && earned.has(s.key))).length;
}

// ---- the book's spreads -----------------------------------------------------------------------

/** The book's 16 pages from the pack (the last is the Bonus page). */
export const PAGES: readonly BookPage[] = (asset("book-pages") as unknown as { pages: BookPage[] }).pages;

export interface Spread { index: number; pages: [BookPage | null, BookPage | null]; zones: string[] }

/** Spread 0: endpaper + contents; then pages 1–2, 3–4, …, 13–14. */
export const SPREADS: readonly Spread[] = [
  { index: 0, pages: [null, null], zones: [] },
  ...Array.from({ length: PAGES.length / 2 }, (_, i) => {
    const l = PAGES[2 * i]!;
    const r = PAGES[2 * i + 1]!;
    return { index: i + 1, pages: [l, r] as [BookPage, BookPage], zones: [...new Set([l.group, r.group])].filter((g): g is string => !!g && GROUPS.includes(g)) };
  }),
];

/** The spread showing a zone's first page (where a tap on that zone opens the book). */
export const spreadOf = (zone: string): number => SPREADS.findIndex((s) => s.zones.includes(zone));

/** The spread that holds a sticker's slot. */
export const spreadOfSticker = (key: string): number =>
  SPREADS.findIndex((s) => s.pages.some((p) => p?.slots.some((sl) => sl.sticker === key)));

// ---- fixed spots ----------------------------------------------------------------------------

export type Scene = "farm" | "museum-interior" | "aquarium-interior";

export interface Spot {
  scene: Scene;
  zone: string;
  /** ground / water / on-bed / bed (bed: no sprite, the bed's stage art shows it) / tank / case / frame… */
  layer: string;
  /** Top-left of the 16x16 sticker in its scene. */
  x: number;
  y: number;
  /** Draw order on the farm (higher in front; characters use their body-box bottom). */
  z: number;
  /** Draw the sticker's sprite there (bed stickers don't: the bed shows them). */
  draw: boolean;
  /** Mirror it so it faces into its zone. */
  flip: boolean;
  /** No designed spot yet (the sticker was added after the art pack): drawn obviously wrong. */
  placeholder: boolean;
}

interface RawSpot {
  sticker: string; scene: Scene; zone: string; layer: string; x: number; y: number; z: number; draw_sprite: boolean; flip_horizontal: boolean;
}
const RAW_SPOTS = (rawSpots as unknown as { spots: RawSpot[] }).spots;

/**
 * The sprite designer's fixed spot for every sticker (sticker-spots.json: no overlaps, each in
 * its zone). A sticker added since (Area cleared) gets a PLACEHOLDER spot at the edge of its
 * zone until it's drawn, marked magenta on the farm.
 */
export const SPOTS: ReadonlyMap<string, Spot> = (() => {
  const out = new Map<string, Spot>();
  for (const r of RAW_SPOTS) {
    out.set(r.sticker, {
      scene: r.scene, zone: r.zone, layer: r.layer, x: r.x, y: r.y, z: r.z, draw: r.draw_sprite, flip: r.flip_horizontal, placeholder: false,
    });
  }
  const boxes = (asset("farm-zone-masks") as unknown as { bboxes: Record<string, [number, number, number, number]> }).bboxes;
  STICKERS.filter((s) => !out.has(s.key)).forEach((s, i) => {
    const [, , x1, y1] = boxes[s.group]!;
    out.set(s.key, {
      scene: "farm", zone: s.group, layer: "ground", x: x1 - 24 - i * 18, y: y1 - 22, z: y1 - 6, draw: true, flip: false, placeholder: true,
    });
  });
  return out;
})();

/** How many times a repeatable sticker (Full month, Area cleared) has been earned; 0 for others. */
export function repeatCount(key: string, c: ReadonlyMap<string, number> | null): number {
  const source = REPEATS[key];
  return source && c ? c.get(source) ?? 0 : 0;
}

/** A sticker's spot id (each sticker has exactly one fixed spot: its own key). */
export const spotIdOf = (key: string): string => key;

// ---- the earned moment queue ---------------------------------------------------------------

/**
 * Stickers whose earned moment hasn't played yet, one at a time in book order. None while she is
 * on the Journal pages (they arrive after she leaves).
 */
export function momentQueue(derived: readonly string[], seen: ReadonlySet<string>, placed: ReadonlyMap<string, string>, onJournal: boolean): string[] {
  // Every moment waits on the Journal pages, whatever earned it (review I5): a check-in can also
  // complete a monthly goal or a month, and those arrive after she leaves too.
  if (onJournal) return [];
  return derived.filter((k) => !seen.has(k) && !placed.has(k));
}

/** Book order index (for sorting). */
export const bookIndex = (key: string): number => {
  const s = STICKER_BY_KEY.get(key);
  return s ? STICKERS.indexOf(s) : STICKERS.length;
};

// ---- Today's list finished -------------------------------------------------------------------

/**
 * The items as they stood at the start of the day: today's ticks undone (a to-do done today is
 * open, a habit's or a project's session today is taken off), and today's moves undone (taken off
 * today, or pinned to a later day, today). The rows are never changed. A deadline moved today
 * can't be put back (its old date isn't kept), so it stays where it is now.
 */
export function atDayStart(items: readonly Item[], today: ISODate): Item[] {
  return items.map((it) => {
    let out = it;
    if (it.hiddenOn === today) {
      const { hiddenOn: _h, ...rest } = out;
      out = rest;
    }
    if (it.touchedAt === today && it.pinnedDate !== undefined && it.pinnedDate > today) {
      const { pinnedDate: _p, ...rest } = out;
      out = rest;
    }
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

/** Moved to another day, today: taken off today, pinned to a later day, or its deadline moved past today. */
export const movedOn = (it: Item, today: ISODate): boolean =>
  it.hiddenOn === today ||
  (it.pinnedDate !== undefined && it.pinnedDate > today) ||
  (it.touchedAt === today && it.due !== undefined && it.due > today);

/**
 * The day's list is finished (review C1; Esme, 2026-11-04): every item on the list as Home showed
 * it that morning (before today's ticks and moves) is ticked today or moved to another day, and
 * at least one was ticked. Rescheduling is never a failure. Home refills its picks from the
 * backlog as she goes, so the live list would almost never be empty; the morning's list counts.
 */
export function todayListFinished(items: Item[], goals: Goal[], today: ISODate): boolean {
  const morning = todayList(atDayStart(items, today), goals, today);
  const listed = [...morning.rhythm, ...morning.picks];
  const now = new Map(items.map((it) => [it.id, it]));
  const current = listed.map((it) => now.get(it.id));
  const ticked = current.filter((it) => it !== undefined && tickedOffToday(it, today)).length;
  return ticked > 0 && current.every((it) => it !== undefined && (tickedOffToday(it, today) || movedOn(it, today)));
}

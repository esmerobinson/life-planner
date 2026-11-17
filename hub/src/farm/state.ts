// Esme's Farm (phase 1): the synced farm state. Only what can't be derived from her real data
// is stored; earned stickers are COMPUTED (farm/earning.ts). One row per fact, so two devices
// never overwrite each other's facts (rows only ever replace themselves, last write wins):
//
//   start:<deviceId>     the day the farm first opened on that device (the farm's start is the
//                        earliest of them, so the start never moves later after a sync)
//   seen:<sticker>       the earned moment has played for that sticker (it is then kept for
//                        good: "nothing is ever lost", even if the count behind it later drops)
//   placed:<sticker>     she placed that sticker on the farm, at its one fixed spot
//   arrived:<character>  the "<name> has moved in!" moment has been shown
//   outfit:<character>   the accessory she picked for that character (null: none)
//   today:<date>         Today's list was seen finished that day (not derivable afterwards:
//                        what was on a past day's list isn't kept)
//   visited:<area>       she has opened that area of Esme's Rio (the map's NEW badge goes)
//   hidden:<sticker>     she hid that placed sticker from its Rio scene (hidden: true), or showed it
//                        again (false). Never deleted: it stays earned, placed and in the Collection
//   spot:<sticker>       she moved that placed sticker to this slot of its scene (Esme, 2026-11-17:
//                        "Items should be movable or deletable from scenes (hide) somehow")
//
// No database import here, so the change tracker and validators can use it without a cycle.

import { isValidISODate } from "../domain/dates";
import type { ISODate } from "../domain/types";

export const FARM_KINDS = ["start", "seen", "placed", "arrived", "outfit", "today", "visited", "hidden", "spot"] as const;
export type FarmKind = (typeof FARM_KINDS)[number];

/** The six characters, in arrival order. */
export const CHARACTERS = ["domino", "bap", "puddle", "clover", "crumpet", "duvet"] as const;
export type CharacterId = (typeof CHARACTERS)[number];

interface Base {
  id: string;
  /** Sync stamp, set on every write by the change tracker. */
  updatedAt?: number;
}
export interface StartRow extends Base { kind: "start"; date: ISODate }
export interface SeenRow extends Base { kind: "seen"; sticker: string; date: ISODate }
export interface PlacedRow extends Base { kind: "placed"; sticker: string; spot: string; date: ISODate }
export interface ArrivedRow extends Base { kind: "arrived"; character: CharacterId; date: ISODate }
export interface OutfitRow extends Base { kind: "outfit"; character: CharacterId; item: string | null }
export interface TodayRow extends Base { kind: "today"; date: ISODate }
export interface VisitedRow extends Base { kind: "visited"; area: string; date: ISODate }
export interface HiddenRow extends Base { kind: "hidden"; sticker: string; hidden: boolean; date: ISODate }
export interface SpotRow extends Base { kind: "spot"; sticker: string; slot: string; date: ISODate }
export type FarmRow = StartRow | SeenRow | PlacedRow | ArrivedRow | OutfitRow | TodayRow | VisitedRow | HiddenRow | SpotRow;

/** Sticker keys, spot ids and Rio area keys: lower-case words and dashes (a later pack may add more). */
const KEY = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A Rio scene's slot id, as the pack writes them (letters of either case, digits, dashes, underscores: "gondola-A-top-1"). */
const SLOT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Device ids, as the sync engine makes them. */
const DEVICE = /^[A-Za-z0-9_-]{1,64}$/;
/** Accessory codes in the art pack (A1–A11, H1–H7; a later pack may add more). */
const ITEM = /^[AH][0-9]{1,2}$/;

const isStr = (v: unknown): v is string => typeof v === "string";
const isDate = (v: unknown): v is ISODate => isStr(v) && isValidISODate(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optStamp = (v: unknown) => v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v > 0);
const isChar = (v: unknown): v is CharacterId => (CHARACTERS as readonly unknown[]).includes(v);

/** Exactly these keys and no others. */
const only = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).every((k) => keys.includes(k));

/** One farm row is valid (sync, local writes). */
export function validFarm(r: unknown): r is FarmRow {
  if (!isObj(r) || !isStr(r.id) || !optStamp(r.updatedAt)) return false;
  const [kind, ...rest] = r.id.split(":");
  const suffix = rest.join(":");
  if (r.kind !== kind) return false;
  switch (r.kind) {
    case "start":
      return DEVICE.test(suffix) && isDate(r.date) && only(r, ["id", "kind", "date", "updatedAt"]);
    case "seen":
      return isStr(r.sticker) && KEY.test(r.sticker) && suffix === r.sticker && isDate(r.date) &&
        only(r, ["id", "kind", "sticker", "date", "updatedAt"]);
    case "placed":
      return isStr(r.sticker) && KEY.test(r.sticker) && suffix === r.sticker && isStr(r.spot) && KEY.test(r.spot) &&
        isDate(r.date) && only(r, ["id", "kind", "sticker", "spot", "date", "updatedAt"]);
    case "arrived":
      return isChar(r.character) && suffix === r.character && isDate(r.date) &&
        only(r, ["id", "kind", "character", "date", "updatedAt"]);
    case "outfit":
      return isChar(r.character) && suffix === r.character && (r.item === null || (isStr(r.item) && ITEM.test(r.item))) &&
        only(r, ["id", "kind", "character", "item", "updatedAt"]);
    case "today":
      return isDate(r.date) && suffix === r.date && only(r, ["id", "kind", "date", "updatedAt"]);
    case "visited":
      return isStr(r.area) && KEY.test(r.area) && suffix === r.area && isDate(r.date) &&
        only(r, ["id", "kind", "area", "date", "updatedAt"]);
    case "hidden":
      return isStr(r.sticker) && KEY.test(r.sticker) && suffix === r.sticker && typeof r.hidden === "boolean" && isDate(r.date) &&
        only(r, ["id", "kind", "sticker", "hidden", "date", "updatedAt"]);
    case "spot":
      return isStr(r.sticker) && KEY.test(r.sticker) && suffix === r.sticker && isStr(r.slot) && SLOT.test(r.slot) && isDate(r.date) &&
        only(r, ["id", "kind", "sticker", "slot", "date", "updatedAt"]);
    default:
      return false;
  }
}

// ---- row builders --------------------------------------------------------------------------

export const startRow = (deviceId: string, date: ISODate): StartRow => ({ id: `start:${deviceId}`, kind: "start", date });
export const seenRow = (sticker: string, date: ISODate): SeenRow => ({ id: `seen:${sticker}`, kind: "seen", sticker, date });
export const placedRow = (sticker: string, spot: string, date: ISODate): PlacedRow =>
  ({ id: `placed:${sticker}`, kind: "placed", sticker, spot, date });
export const arrivedRow = (character: CharacterId, date: ISODate): ArrivedRow =>
  ({ id: `arrived:${character}`, kind: "arrived", character, date });
export const outfitRow = (character: CharacterId, item: string | null): OutfitRow =>
  ({ id: `outfit:${character}`, kind: "outfit", character, item });
export const todayRow = (date: ISODate): TodayRow => ({ id: `today:${date}`, kind: "today", date });
export const visitedRow = (area: string, date: ISODate): VisitedRow => ({ id: `visited:${area}`, kind: "visited", area, date });
export const hiddenRow = (sticker: string, hidden: boolean, date: ISODate): HiddenRow => ({ id: `hidden:${sticker}`, kind: "hidden", sticker, hidden, date });
export const spotRow = (sticker: string, slot: string, date: ISODate): SpotRow => ({ id: `spot:${sticker}`, kind: "spot", sticker, slot, date });

// ---- the state, read from the rows ---------------------------------------------------------

export interface FarmState {
  /** The farm's start (the earliest start row), or null before the farm was ever opened. */
  start: ISODate | null;
  seen: ReadonlySet<string>;
  /** The day each seen sticker went into the collection (its seen row's date). */
  seenOn: ReadonlyMap<string, ISODate>;
  /** Placed sticker -> its spot. */
  placed: ReadonlyMap<string, string>;
  arrived: ReadonlySet<CharacterId>;
  outfits: ReadonlyMap<CharacterId, string | null>;
  /** Days Today's list was seen finished. */
  todayDone: readonly ISODate[];
  /** Rio areas she has opened. */
  visited: ReadonlySet<string>;
  /** Placed stickers she hid from their scene (still earned, placed and in the Collection). */
  hidden: ReadonlySet<string>;
  /** Placed sticker -> the slot she moved it to in its scene. */
  spots: ReadonlyMap<string, string>;
}

export const EMPTY_FARM: FarmState = {
  start: null, seen: new Set(), seenOn: new Map(), placed: new Map(), arrived: new Set(), outfits: new Map(), todayDone: [], visited: new Set(),
  hidden: new Set(), spots: new Map(),
};

/** The farm state from its rows (rows that aren't valid are ignored). */
export function farmState(rows: readonly unknown[]): FarmState {
  const starts: ISODate[] = [];
  const seen = new Set<string>();
  const seenOn = new Map<string, ISODate>();
  const placed = new Map<string, string>();
  const arrived = new Set<CharacterId>();
  const outfits = new Map<CharacterId, string | null>();
  const todayDone: ISODate[] = [];
  const visited = new Set<string>();
  const hidden = new Set<string>();
  const spots = new Map<string, string>();
  for (const r of rows) {
    if (!validFarm(r)) continue;
    if (r.kind === "start") starts.push(r.date);
    else if (r.kind === "seen") {
      seen.add(r.sticker);
      seenOn.set(r.sticker, r.date);
    }
    else if (r.kind === "placed") placed.set(r.sticker, r.spot);
    else if (r.kind === "arrived") arrived.add(r.character);
    else if (r.kind === "outfit") outfits.set(r.character, r.item);
    else if (r.kind === "visited") visited.add(r.area);
    else if (r.kind === "hidden") { if (r.hidden) hidden.add(r.sticker); }
    else if (r.kind === "spot") spots.set(r.sticker, r.slot);
    else todayDone.push(r.date);
  }
  todayDone.sort();
  const start = starts.length ? starts.sort()[0]! : null;
  return { start, seen, seenOn, placed, arrived, outfits, todayDone, visited, hidden, spots };
}

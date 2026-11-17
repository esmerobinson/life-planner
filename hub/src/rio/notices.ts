// Esme's Rio: what the Noticeboard can honestly say today, from real data only: the next place to
// open (map.json's opening days, counted from the game's start), the stickers that went into the
// collection lately, and the next friend to move in (at N stickers or on day N, whichever comes
// first). Bundles, the stuck task, themed nights and the pinned dish come with phase 2.

import { addDays, daysBetween } from "../domain/dates";
import type { ISODate } from "../domain/types";
import { STICKER_BY_KEY } from "../farm/catalogue";
import type { CharacterId } from "../farm/state";
import { ARRIVES_AT, LIVING, NAMES } from "../farm/world";
import { opensOn, type AreaStatus } from "./areas";
import { RIO_MAP } from "./assets";

export interface NextOpening { key: string; name: string; day: number; date: ISODate; inDays: number }

/** The place with the padlock, the day it opens and its date (null once all are open, or before the start). */
export function nextOpening(statuses: ReadonlyMap<string, AreaStatus>, start: ISODate | null, today: ISODate): NextOpening | null {
  if (!start) return null;
  const key = [...statuses].find(([, s]) => s === "next")?.[0];
  const day = key ? opensOn(key) : null;
  if (!key || day === null) return null;
  const date = addDays(start, day - 1);
  return { key, name: RIO_MAP.places.find((p) => p.key === key)?.name ?? key, day, date, inDays: daysBetween(today, date) };
}

const bookIndex = (k: string) => STICKER_BY_KEY.get(k)?.index ?? Number.MAX_SAFE_INTEGER;

/** The `n` stickers that went into the collection most lately: newest day first, then book order. */
export function recentStickers(seenOn: ReadonlyMap<string, ISODate>, n = 5): string[] {
  return [...seenOn]
    .filter(([k]) => STICKER_BY_KEY.has(k))
    .sort(([a, da], [b, db]) => (da === db ? bookIndex(a) - bookIndex(b) : da < db ? 1 : -1))
    .slice(0, n)
    .map(([k]) => k);
}

export interface NextFriend { id: CharacterId; name: string; at: number; stickersToGo: number; daysToGo: number }

/** The next friend to move in (`friends`: the sticker count friends go by; `day`: the game's day). */
export function nextFriend(friends: number, day: number, arrived: ReadonlySet<CharacterId>): NextFriend | null {
  const c = LIVING.find((ch) => !arrived.has(ch));
  if (!c) return null;
  const at = ARRIVES_AT[c];
  return { id: c, name: NAMES[c], at, stickersToGo: Math.max(0, at - friends), daysToGo: Math.max(0, at - day) };
}

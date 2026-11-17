// Esme's Rio: the Collection (the game menu's tab that replaces the sticker book, Esme 2026-11-17).
// Her stickers are grouped by the Rio area that took each phase-1 zone over (rio-design.md,
// "Nothing is lost"); an area's pages are its zones, each in book order. Areas come in their
// opening order (map.json), the bonus page last.

import { STICKERS } from "../farm/catalogue";
import type { FarmView } from "../farm/FarmContext";
import { RIO_MAP } from "./assets";
import { inScenes } from "./placement";

export interface CollectionPage { title: string; stickers: string[] }
export interface CollectionArea { key: string; name: string; icon: string; pages: CollectionPage[] }

/** A page: a zone's stickers (or one set of it), in book order. */
const page = (title: string, group: string, set?: string): CollectionPage => ({
  title,
  stickers: STICKERS.filter((s) => s.group === group && (set === undefined || s.set === set)).map((s) => s.key),
});

const placeName = (key: string, fallback: string) => RIO_MAP.places.find((p) => p.key === key)?.name ?? fallback;

// The kit has a 12x12 icon per farm zone; each Rio area wears the icon of the zone it took over
// (the bonus page, the kit's star). Esme's call to confirm.
// PLACEHOLDER WORDING (page titles: the old book's page names)
export const COLLECTION_AREAS: readonly CollectionArea[] = [
  { key: "lagoa-house", name: placeName("lagoa-house", "Lagoa house"), icon: "icon-cottage", pages: [page("Kind notes", "lane", "Kind notes")] },
  { key: "fazenda", name: placeName("fazenda", "Fazenda"), icon: "icon-veggarden", pages: [page("Vegetable beds", "beds"), page("Barnyard", "barnyard")] },
  { key: "ipanema-beach", name: placeName("ipanema-beach", "Ipanema beach"), icon: "icon-pond", pages: [page("Pond", "pond"), page("Aquarium", "aquarium")] },
  { key: "tijuca-park", name: placeName("tijuca-park", "Tijuca park"), icon: "icon-meadow", pages: [page("Meadow", "meadow"), page("Hedgerow", "lane", "Hedgerow")] },
  { key: "jardim-botanico", name: placeName("jardim-botanico", "Jardim Botânico"), icon: "icon-orchard", pages: [page("Orchard", "orchard"), page("Glasshouse", "glasshouse")] },
  { key: "museum", name: placeName("museum", "Museum"), icon: "icon-museum", pages: [page("Museum", "museum")] },
  { key: "boteco", name: placeName("boteco", "Boteco"), icon: "icon-saloon", pages: [page("Farmhouse", "farmhouse")] },
  { key: "bonus", name: "Bonus", icon: "icon-star", pages: [page("Area cleared", "bonus")] },
];

const AREA_OF = new Map(COLLECTION_AREAS.flatMap((a) => a.pages.flatMap((p) => p.stickers.map((k) => [k, a.key] as const))));

/** The Collection area a sticker is shown under. */
export const areaOfSticker = (key: string): string => AREA_OF.get(key) ?? "bonus";

/** The zones (phase-1 groups) an area's pages show: the nook's host follows them. */
export const groupsOf = (area: string): string[] =>
  [...new Set((COLLECTION_AREAS.find((a) => a.key === area)?.pages ?? []).flatMap((p) => p.stickers.map((k) => STICKERS.find((s) => s.key === k)!.group)))];

export type CellState = "placed" | "ready" | "kept" | "ghost";

/**
 * Placed in Rio, earned and ready to place, earned and kept in the Collection only (no place in a
 * scene: placement.ts inScenes), or not yet earned (shown as its silhouette).
 */
export function cellState(key: string, view: { earnedSet: ReadonlySet<string>; state: { placed: ReadonlyMap<string, string> } } | Pick<FarmView, "earnedSet" | "state">): CellState {
  if (!inScenes(key) && (view.state.placed.has(key) || view.earnedSet.has(key))) return "kept";
  if (view.state.placed.has(key)) return "placed";
  return view.earnedSet.has(key) ? "ready" : "ghost";
}

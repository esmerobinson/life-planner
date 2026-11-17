// Esme's Rio: where each earned sticker sits. A phase-1 sticker's zone maps to the area that took
// it over (rio-design.md, "Nothing is lost"); inside its scene, placed stickers take, in book
// order, the first free slot whose `accepts` (the pack's tags) takes them, one per slot. The old
// phase-1 spot id is never read, so the move needs no migration and nothing can be lost by it;
// the one slot ever stored is where she moved a sticker herself (a farm `spot` row, edit mode).

import { STICKER_BY_KEY } from "../farm/catalogue";
import { SCENES, type SceneId, type Slot } from "./assets";

export type Home = { area: string; scene: SceneId } | null;

/** Each phase-1 group's home (null: its area has no art yet, so its stickers wait in the book). */
export const HOME: Record<string, Home> = {
  beds: { area: "fazenda", scene: "fazenda/outside" },
  barnyard: { area: "fazenda", scene: "fazenda/outside" },
  meadow: { area: "tijuca-park", scene: "tijuca-park/outside" },
  /** By set (HOME_BY_SET). */
  lane: null,
  pond: { area: "ipanema-beach", scene: "ipanema-beach/outside" },
  aquarium: { area: "ipanema-beach", scene: "ipanema-beach/sea" },
  farmhouse: { area: "boteco", scene: "boteco/inside" },
  orchard: { area: "jardim-botanico", scene: "jardim-botanico/outside" }, // the palm avenue (phase 2a)
  glasshouse: { area: "jardim-botanico", scene: "jardim-botanico/inside" }, // the orchid house (phase 2a)
  museum: { area: "museum", scene: "museum/inside" }, // the hall's displays (phase 2a)
  bonus: null,
};

/**
 * Only Rio art in Rio scenes (Esme, 2026-11-17: the old farm-style "HI!" and "OK" notes and the
 * "]" door note looked random in the Lagoa garden). A phase-1 sticker is drawn in a scene only if
 * the Rio family that took its set over lives in that scene (the rio pack's sticker manifest,
 * `place`). The Kind notes' family (`notes`) lives at the Lagoa house letterbox, a hotspot that
 * opens a UI, not a scene: they stay earned and in the Collection only. Every other set's family
 * lives where it is laid out.
 */
export const COLLECTION_ONLY_SETS: ReadonlySet<string> = new Set(["lane/Kind notes"]);

/** The sticker can be drawn in a Rio scene (false: kept in the Collection only). */
export function inScenes(stickerKey: string): boolean {
  const s = STICKER_BY_KEY.get(stickerKey);
  return !!s && !COLLECTION_ONLY_SETS.has(`${s.group}/${s.set}`);
}

/** Sets that go somewhere other than their group. */
export const HOME_BY_SET: Record<string, Home> = {
  "lane/Kind notes": null, // kept in the Collection (COLLECTION_ONLY_SETS); placed rows from before stay, unread
  "lane/Hedgerow": { area: "tijuca-park", scene: "tijuca-park/inside" },
};

/**
 * The pack tags a phase-1 sticker answers to, from the family that took its zone over. Barnyard
 * animals answer only to their own animal's slots (the pack draws those spots for that animal).
 */
const TAGS_BY_GROUP: Record<string, string[]> = {
  beds: ["fazenda:*", "veg-garden:*", "outdoor"],
  barnyard: ["fazenda:*", "outdoor"],
  meadow: ["hedgerow:*", "finds:*"],
  pond: ["pond"],
  aquarium: ["fish:fish"], // the sea off Arpoador's swim slots
  farmhouse: ["boteco:*"],
  // The Jardim Botânico's kinds (its manifest's stickerAccepts): fruit trees, the swing and the
  // picnic blanket on the tree spots; the glasshouse's plants on the plant spots.
  orchard: ["trees:tree"],
  glasshouse: ["greenhouse:plant"],
  museum: ["museum"], // the hall's plinths, cases and shelves
};
/** Single stickers whose kind differs from their group's. */
const TAGS_BY_KEY: Record<string, string[]> = {
  // The two workbook fish (a whole workbook finished) take the sea's rare-fish showcase, which the
  // pack draws for exactly those.
  moonfish: ["fish:rare"],
  "golden-carp": ["fish:rare"],
  // The glasshouse's potting things go where the seed packet goes.
  seedtray: ["greenhouse:seeds"],
  // The potted trees stand in the orchid house's floor tubs (the pack's "trees:tree" spots).
  lemontree: ["trees:tree"],
  "fig-tree": ["trees:tree"],
  seedling: ["greenhouse:seeds"],
  wateringcan: ["greenhouse:seeds"],
};
const TAGS_BY_SET: Record<string, string[]> = {
  "lane/Kind notes": ["lagoa-garden:*", "outdoor"],
  "lane/Hedgerow": ["hedgerow:*", "finds:*"],
};
/** Barnyard animals and the pack's animal slots (a lamb on a sheep's spot, a piglet on a pig's). */
const ANIMAL: Record<string, string> = { hen: "hen", chick: "chick", cow: "cow", sheep: "sheep", lamb: "sheep", piglet: "pig" };

export function stickerTags(stickerKey: string): string[] {
  const s = STICKER_BY_KEY.get(stickerKey);
  if (!s) return [];
  if (s.group === "barnyard" && ANIMAL[s.key]) return [ANIMAL[s.key]!];
  if ((s.group === "glasshouse" || s.group === "aquarium") && TAGS_BY_KEY[s.key]) return TAGS_BY_KEY[s.key]!;
  return TAGS_BY_SET[`${s.group}/${s.set}`] ?? TAGS_BY_GROUP[s.group] ?? [];
}

/** "a:*" takes any "a:…" (either side); otherwise the tags must be equal. */
const tagMatch = (slotTag: string, tag: string) =>
  slotTag === tag ||
  (slotTag.endsWith(":*") && tag.startsWith(slotTag.slice(0, -1))) ||
  (tag.endsWith(":*") && slotTag.startsWith(tag.slice(0, -1)));

/** The slot takes a sticker with these tags. */
export const accepts = (slot: Pick<Slot, "accepts">, tags: readonly string[]): boolean =>
  slot.accepts.some((a) => tags.some((t) => tagMatch(a, t)));

export function homeOf(stickerKey: string): Home {
  const s = STICKER_BY_KEY.get(stickerKey);
  if (!s) return null;
  const bySet = HOME_BY_SET[`${s.group}/${s.set}`];
  if (bySet !== undefined) return bySet;
  return HOME[s.group] ?? null;
}

const slotCount = (scene: SceneId) => new Set(SCENES[scene].slots.map((s) => s.id)).size;

/** Which drawn state a scene shows for the stickers placed in it (it only ever fills in). */
export function sceneState(scene: SceneId, placedHere: number): string {
  const n = slotCount(scene);
  if ("stage1" in SCENES[scene].base) return placedHere * 3 < n ? "stage1" : placedHere * 3 < 2 * n ? "stage2" : "stage3";
  return placedHere * 2 >= n ? "full" : "start";
}

/**
 * Scenes whose slots list a main kind first (accepts[0]) and fall back to others: a sticker takes a
 * free slot made for its own kind before a fallback one, so plants don't fill the pools while the
 * bench stands empty (review I2). Only these scenes: phase-1 layouts stay exactly as they were.
 */
const KIND_FIRST: ReadonlySet<SceneId> = new Set<SceneId>(["jardim-botanico/outside", "jardim-botanico/inside"]);

/** The slots free in a state (a slot that needs a milestone, only once it is earned). */
export const slotsIn = (scene: SceneId, state: string, milestones: readonly string[] = []): Slot[] =>
  SCENES[scene].slots.filter((s) => (!s.state || s.state === state) && (!s.requires || milestones.includes(s.requires)));

/**
 * The scene's own placed stickers (of `placed`, any order) in book order, each in the first free
 * slot (slot order) that takes it; `overflow` is how many found no slot (they stay in the book).
 * `spots` (a sticker she moved: its slot) come first, where that slot is free in this state and
 * takes the sticker; a spot that isn't (a slot gone, taken, or the wrong kind) is ignored and the
 * sticker takes its usual place, so a move can never lose one.
 */
export function layout(scene: SceneId, placed: readonly string[], milestones: readonly string[] = [],
  spots: ReadonlyMap<string, string> = NO_SPOTS): { bySlot: Map<string, string>; overflow: number } {
  const mine = placed
    .filter((k) => homeOf(k)?.scene === scene)
    .sort((a, b) => STICKER_BY_KEY.get(a)!.index - STICKER_BY_KEY.get(b)!.index);
  const free = slotsIn(scene, sceneState(scene, mine.length), milestones);
  const bySlot = new Map<string, string>();
  const laid = new Set<string>();
  for (const k of mine) {
    const want = spots.get(k);
    const slot = want ? free.find((s) => s.id === want) : undefined;
    if (slot && !bySlot.has(slot.id) && accepts(slot, stickerTags(k))) {
      bySlot.set(slot.id, k);
      laid.add(k);
    }
  }
  let overflow = 0;
  for (const k of mine) {
    if (laid.has(k)) continue;
    const tags = stickerTags(k);
    const open = (s: Slot) => !bySlot.has(s.id) && accepts(s, tags);
    const slot = (KIND_FIRST.has(scene) ? free.find((s) => open(s) && tags.includes(s.accepts[0]!)) : undefined) ?? free.find(open);
    if (slot) bySlot.set(slot.id, k);
    else overflow++;
  }
  return { bySlot, overflow };
}

const NO_SPOTS: ReadonlyMap<string, string> = new Map();

/** Where a placed sticker can move in its scene: the free slots there that take it (its own and taken ones left out). */
export function freeSlotsFor(scene: SceneId, sticker: string, placed: readonly string[], milestones: readonly string[] = [],
  spots: ReadonlyMap<string, string> = NO_SPOTS): Slot[] {
  const { bySlot } = layout(scene, placed, milestones, spots);
  const mine = placed.filter((k) => homeOf(k)?.scene === scene).length;
  const tags = stickerTags(sticker);
  return slotsIn(scene, sceneState(scene, mine), milestones).filter((s) => !bySlot.has(s.id) && accepts(s, tags));
}

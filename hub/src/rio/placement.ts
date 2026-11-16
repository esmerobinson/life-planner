// Esme's Rio: where each earned sticker sits. A phase-1 sticker's zone maps to the area that took
// it over (rio-design.md, "Nothing is lost"); inside its scene, placed stickers take, in book
// order, the first free slot whose `accepts` (the pack's tags) takes them, one per slot. Nothing
// about a slot is stored: the old phase-1 spot id is never read, so the move needs no migration
// and nothing can be lost by it.

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
  museum: null, // the museum: no Rio night or rain art yet
  bonus: null,
};

/** Sets that go somewhere other than their group. */
export const HOME_BY_SET: Record<string, Home> = {
  "lane/Kind notes": { area: "lagoa-house", scene: "lagoa-house/outside" },
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
};
/** Single stickers whose kind differs from their group's. */
const TAGS_BY_KEY: Record<string, string[]> = {
  // The two workbook fish (a whole workbook finished) take the sea's rare-fish showcase, which the
  // pack draws for exactly those.
  moonfish: ["fish:rare"],
  "golden-carp": ["fish:rare"],
  // The glasshouse's potting things go where the seed packet goes.
  seedtray: ["greenhouse:seeds"],
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

/** The slots free in a state (a slot that needs a milestone, only once it is earned). */
export const slotsIn = (scene: SceneId, state: string, milestones: readonly string[] = []): Slot[] =>
  SCENES[scene].slots.filter((s) => (!s.state || s.state === state) && (!s.requires || milestones.includes(s.requires)));

/**
 * The scene's own placed stickers (of `placed`, any order) in book order, each in the first free
 * slot (slot order) that takes it; `overflow` is how many found no slot (they stay in the book).
 */
export function layout(scene: SceneId, placed: readonly string[], milestones: readonly string[] = []): { bySlot: Map<string, string>; overflow: number } {
  const mine = placed
    .filter((k) => homeOf(k)?.scene === scene)
    .sort((a, b) => STICKER_BY_KEY.get(a)!.index - STICKER_BY_KEY.get(b)!.index);
  const free = slotsIn(scene, sceneState(scene, mine.length), milestones);
  const bySlot = new Map<string, string>();
  let overflow = 0;
  for (const k of mine) {
    const tags = stickerTags(k);
    const slot = free.find((s) => !bySlot.has(s.id) && accepts(s, tags));
    if (slot) bySlot.set(slot.id, k);
    else overflow++;
  }
  return { bySlot, overflow };
}

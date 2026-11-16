// Esme's Rio: where each earned sticker sits. A phase-1 sticker's zone maps to the area that took
// it over (rio-design.md, "Nothing is lost"); inside its scene, placed stickers fill the slots in
// book order, one per slot. Nothing about a slot is stored: the old phase-1 spot id is never
// read, so the move needs no migration and nothing can be lost by it.

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
  orchard: null, // Jardim Botânico
  glasshouse: null, // the orchid house
  museum: null, // the museum
  bonus: null,
};

/** Sets that go somewhere other than their group. */
export const HOME_BY_SET: Record<string, Home> = {
  "lane/Kind notes": { area: "lagoa-house", scene: "lagoa-house/outside" },
  "lane/Hedgerow": { area: "tijuca-park", scene: "tijuca-park/inside" },
};

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

/** The slots free in a state. */
export const slotsIn = (scene: SceneId, state: string): Slot[] =>
  SCENES[scene].slots.filter((s) => !s.state || s.state === state);

/**
 * The scene's own placed stickers (of `placed`, any order) in book order, one per slot in slot
 * order; `overflow` is how many more there are than slots (they stay in the book).
 */
export function layout(scene: SceneId, placed: readonly string[]): { bySlot: Map<string, string>; overflow: number } {
  const mine = placed
    .filter((k) => homeOf(k)?.scene === scene)
    .sort((a, b) => STICKER_BY_KEY.get(a)!.index - STICKER_BY_KEY.get(b)!.index);
  const slots = slotsIn(scene, sceneState(scene, mine.length));
  const bySlot = new Map<string, string>();
  mine.slice(0, slots.length).forEach((k, i) => bySlot.set(slots[i]!.id, k));
  return { bySlot, overflow: Math.max(0, mine.length - slots.length) };
}

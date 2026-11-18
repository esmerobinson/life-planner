// Esme's Rio: the ways in and out of every scene (Esme, 2026-11-17: "it would be better to hover
// and click on doors"; "I would like the exit of an area to be the way to go back to map. You
// should be able to walk between different rooms in the house via staircase or door not
// buttons"). One shape for all of them, a rect in the scene's pixels and where it leads (a
// scene, or the map) or the menu tab it opens, so a walking Esme (a later build) can trigger the
// same doors by walking into them. Read from the pack's hotspots ({ rect, to, label }); where an
// area's pack has none yet, from the app-side table below (each one says where it came from).

import { AREA_SCENES } from "./areas";
import { SCENES, type Rect, type SceneId } from "./assets";

/** The menu tabs a hotspot can open (the beach noticeboard, the store's fitting room). */
export type DoorMenu = "noticeboard" | "wardrobe";

export interface Door {
  id: string;
  /** x, y, w, h in the scene's pixels. */
  rect: Rect;
  /** The scene it leads to, "map" for an exit, or null when it opens a menu tab. */
  to: SceneId | "map" | null;
  opens?: DoorMenu;
  label: string;
}

/** The area each scene belongs to (the beach is Ipanema's; the barraca's inside, the barraca's). */
export const SCENE_AREA = (() => {
  const out: Partial<Record<SceneId, string>> = {};
  for (const [area, { outside, inside }] of Object.entries(AREA_SCENES)) {
    out[outside] ??= area;
    for (const s of inside) out[s] ??= area;
  }
  return out as Record<SceneId, string>;
})();

const isScene = (s: string): s is SceneId => s in SCENES;

/** What the pack's `to` means here, from the scene it's in; null when it leads nowhere built yet. */
export function resolveTo(scene: SceneId, raw: string): { to: SceneId | "map" | null; opens?: DoorMenu } | null {
  if (raw === "map") return { to: "map" };
  // The store's fitting room: the wardrobe (Esme, 2026-11-17: "Same with dressing room in store").
  if (raw === "fitting_room") return { to: null, opens: "wardrobe" };
  if (isScene(raw)) return { to: raw };
  const area = AREA_SCENES[SCENE_AREA[scene]]!;
  const prefix = scene.split("/")[0]!;
  if (raw === "outside") return { to: area.outside };
  if (raw === "inside") return area.inside[0] ? { to: area.inside[0] } : null;
  const dashed = raw.replace(/-(inside|outside)$/, "/$1"); // "barraca-inside"
  if (isScene(dashed)) return { to: dashed };
  if (AREA_SCENES[raw]) return { to: AREA_SCENES[raw]!.outside }; // an area: its outside ("ipanema-beach")
  const room = `${prefix}/${raw.replace(/^inside\//, "")}`; // "inside/living", "bedroom"
  if (isScene(room)) return { to: room };
  return null; // the fazenda's barn, coop and greenhouse: their insides aren't in the pack yet
}

const NOTCH = (tx: number, ty: number): Rect => [tx * 16, ty * 16, 32, 16]; // a door notch, two 16 px tiles wide

/**
 * App-side doors, used where a scene's pack has none yet (PLACEHOLDER WORDING, every label): the
 * museum's pack has no slots file; its door and stairs come from plaza-slots.json and
 * room-hall.json.
 */
const APP_DOORS: Partial<Record<SceneId, Door[]>> = {
  "museum/outside": [
    { id: "door", rect: [152, 72, 16, 26], to: "museum/inside", label: "Museum doors" },
    { id: "stairs", rect: [144, 170, 32, 22], to: "map", label: "Stone stairs (back to the map)" },
  ],
  "museum/inside": [{ id: "door", rect: NOTCH(10, 13), to: "museum/outside", label: "Out to the plaza" }],
};

/** Doors the pack doesn't draw yet, added where the scene has no door to the same place. */
const APP_EXTRA: Partial<Record<SceneId, Door[]>> = {
  // ipanema-slots.json's older "sea" hotspot: the water by Arpoador (opens on day 30).
  "ipanema-beach/outside": [{ id: "sea", rect: [300, 140, 52, 40], to: "ipanema-beach/sea", label: "Swim out to Arpoador" }],
};

const cache = new Map<SceneId, Door[]>();

/** Every door in a scene (whether she can use it yet is the caller's: an area may not be open). */
export function doorsFor(scene: SceneId): Door[] {
  let out = cache.get(scene);
  if (out) return out;
  const pack = (SCENES[scene].doors ?? []).flatMap((d): Door[] => {
    const r = d.opens === "noticeboard" ? { to: null, opens: "noticeboard" as const } : d.to ? resolveTo(scene, d.to) : null;
    if (!r) return [];
    return [{ id: d.id, rect: d.rect, ...r, label: d.label || (r.to && r.to !== "map" ? r.to : "Back to the map") }]; // PLACEHOLDER WORDING
  });
  out = pack.length ? pack : APP_DOORS[scene] ?? [];
  const extra = (APP_EXTRA[scene] ?? []).filter((e) => !out!.some((d) => d.to === e.to));
  out = [...out, ...extra];
  cache.set(scene, out);
  return out;
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The hotbar stands over the bottom centre of the game, where many rooms draw their door notch:
 * a door it would hide reaches up so at least `show` CSS px of it stand clear above the bar
 * (its picture is left as drawn; only where she can point at it grows).
 */
export function clearOfHotbar(r: Box, bar: { left: number; right: number; top: number }, show: number): Box {
  const under = r.x < bar.right && r.x + r.w > bar.left && r.y + r.h > bar.top;
  if (!under || bar.top - r.y >= show) return r;
  const y = bar.top - show;
  return { x: r.x, y, w: r.w, h: r.y + r.h - y };
}

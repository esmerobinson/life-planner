// Esme's Rio: which areas are open, by farm day (the opening-order table in rio-design.md, as
// map.json carries it). An area opens only once its art exists; everything else stays under
// cloud, and only the next area to open wears the padlock.

import { RIO_MAP, type SceneId } from "./assets";

/** The areas drawn so far: their outside scene and the insides reached from it. */
export const AREA_SCENES: Record<string, { outside: SceneId; inside: SceneId[] }> = {
  "lagoa-house": { outside: "lagoa-house/outside", inside: ["lagoa-house/living", "lagoa-house/bedroom", "lagoa-house/kitchen"] },
  fazenda: { outside: "fazenda/outside", inside: [] },
  "ipanema-beach": { outside: "ipanema-beach/outside", inside: ["ipanema-beach/sea"] },
  barraca: { outside: "ipanema-beach/outside", inside: ["barraca/inside"] },
  "clothing-store": { outside: "clothing-store/outside", inside: ["clothing-store/inside"] },
  "tijuca-park": { outside: "tijuca-park/outside", inside: ["tijuca-park/inside"] },
  boteco: { outside: "boteco/outside", inside: ["boteco/inside"] },
  // Phase 2a: drawn since phase 1 (the museum once its Rio night and rain landed, 2026-11-17).
  museum: { outside: "museum/outside", inside: ["museum/inside"] },
  "flamengo-match": { outside: "flamengo-match/outside", inside: ["flamengo-match/inside"] },
  "zona-sul": { outside: "zona-sul/outside", inside: ["zona-sul/inside"] },
  "jardim-botanico": { outside: "jardim-botanico/outside", inside: ["jardim-botanico/inside"] },
  quilo: { outside: "quilo/outside", inside: ["quilo/inside"] },
  sult: { outside: "sult/outside", inside: ["sult/inside"] },
  "santa-teresa": { outside: "santa-teresa/outside", inside: ["santa-teresa/inside"] },
  "os-esquilos": { outside: "os-esquilos/outside", inside: ["os-esquilos/inside"] },
};

/**
 * Inside scenes that open later than their area (rio-design.md's opening order): the sea off
 * Arpoador opens on day 30 (Esme, 2026-11-16). Until then there is no way in, and its stickers
 * wait in the book like any place that hasn't opened.
 */
export const SCENE_OPENS: Partial<Record<SceneId, number>> = { "ipanema-beach/sea": 30 };

/** The scene is open on this farm day (every other scene opens with its area). */
export const sceneOpen = (scene: SceneId, day: number): boolean => day >= (SCENE_OPENS[scene] ?? 1);

export type AreaStatus = "open" | "new" | "next" | "locked";

const PLACE = new Map(RIO_MAP.places.map((p) => [p.key, p]));

/** The farm day an area opens on: null for the last one (Christ) and for areas with no art yet. */
export function opensOn(key: string): number | null {
  const p = PLACE.get(key);
  if (!p || !AREA_SCENES[key] || p.opens === "last") return null;
  return p.opens_day;
}

/** Every place on the map: open (visited), new (open, not visited yet), next (the padlock) or locked. */
export function areaStatuses(day: number, visited: ReadonlySet<string>): Map<string, AreaStatus> {
  const out = new Map<string, AreaStatus>();
  let next: { key: string; day: number } | null = null;
  for (const p of RIO_MAP.places) {
    const on = opensOn(p.key);
    if (on !== null && day >= on) out.set(p.key, visited.has(p.key) ? "open" : "new");
    else {
      out.set(p.key, "locked");
      if (on !== null && (!next || on < next.day)) next = { key: p.key, day: on };
    }
  }
  if (next) out.set(next.key, "next");
  return out;
}

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
};

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

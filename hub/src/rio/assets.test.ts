import { BOTECO_NIGHTS, LOOKS, RIO_MAP, SCENES, mapBase, mapLayer, rioUrl, type SceneId } from "./assets";

describe("the Rio art pack is bundled", () => {
  it("every map layer file is bundled", () => {
    for (const p of [...RIO_MAP.places, RIO_MAP.boat_route]) {
      for (const look of ["day", "night", "rain"] as const) {
        for (const state of ["open", "locked"] as const) {
          const path = mapLayer(p, look, state);
          expect(rioUrl(`day1/map/${path}`), `${p.key} ${state} ${look}`).not.toBe("");
        }
      }
    }
    for (const m of ["locked", "new", "here", "stuck"] as const) expect(rioUrl(`day1/map/${RIO_MAP.markers[m].file}`)).not.toBe("");
    for (const look of ["day", "night", "rain"] as const) expect(rioUrl(`day1/map/${mapBase(look)}`)).not.toBe("");
    for (const f of RIO_MAP.weather?.rain?.overlay.frames ?? []) expect(rioUrl(`day1/map/${f}`)).not.toBe("");
  });

  it("every scene base file is bundled", () => {
    const ids = Object.keys(SCENES) as SceneId[];
    expect(ids.length).toBe(26);
    for (const id of ids) {
      const s = SCENES[id];
      expect(Object.keys(s.base).length, id).toBeGreaterThan(0);
      for (const [state, looks] of Object.entries(s.base)) {
        expect(looks.day, `${id} ${state} day`).toBeTruthy();
        for (const look of LOOKS) {
          const path = looks[look];
          if (path) expect(rioUrl(path), `${id} ${state} ${look}`).not.toBe("");
        }
      }
      for (const f of s.rainOverlay?.frames ?? []) expect(rioUrl(f), `${id} rain overlay`).not.toBe("");
      if (s.rainOverlay?.strip) expect(rioUrl(s.rainOverlay.strip.file)).not.toBe("");
      for (const frames of Object.values(s.tv?.frames ?? {})) for (const f of frames) expect(rioUrl(f), `${id} tv`).not.toBe("");
    }
  });

  it("the outdoor scenes with a rain look have their falling rain", () => {
    for (const id of ["lagoa-house/outside", "fazenda/outside", "ipanema-beach/outside", "barraca/inside", "clothing-store/outside",
      "tijuca-park/outside", "tijuca-park/inside", "boteco/outside", "lagoa-house/living"] as SceneId[]) {
      expect(SCENES[id].rainOverlay, id).toBeTruthy();
    }
  });

  it("map has 21 places and the inset", () => {
    expect(RIO_MAP.places.length).toBe(21);
    expect(RIO_MAP.places.some((p) => p.key === "fazenda")).toBe(true);
    expect(RIO_MAP.inset.key).toBe("fazenda");
    expect(RIO_MAP.canvas).toEqual([896, 504]);
  });

  it("scene slot ids are unique within a scene (in each state)", () => {
    for (const [id, s] of Object.entries(SCENES)) {
      for (const state of Object.keys(s.base)) {
        const ids = s.slots.filter((x) => !x.state || x.state === state).map((x) => x.id);
        expect(new Set(ids).size, `${id} ${state}`).toBe(ids.length);
      }
    }
  });

  it("a missing file gives an empty url", () => {
    expect(rioUrl("day1/map/nothing-here.png")).toBe("");
  });

  it("the map's rain look falls back to day while the pack has none", () => {
    const lagoa = RIO_MAP.places.find((p) => p.key === "lagoa-house")!;
    const rain = (lagoa.layers as Record<string, unknown>).rain as { open: string } | undefined;
    expect(mapLayer(lagoa, "rain", "open")).toBe(rain ? rain.open : lagoa.layers.day.open);
    expect(mapLayer(lagoa, "night", "locked")).toBe(lagoa.layers.night.locked);
  });
});

describe("the map's rain look (added to the pack 2026-11-15)", () => {
  it("is used now that the pack has it: rain layers, rain base and the falling rain", () => {
    const lagoa = RIO_MAP.places.find((p) => p.key === "lagoa-house")!;
    expect(mapLayer(lagoa, "rain", "open")).toBe("layers/lagoa-house-open-rain.png");
    expect(mapBase("rain")).toBe("map-base-rain.png");
    expect(RIO_MAP.weather?.rain?.overlay.frames.length).toBe(4);
  });
  it("holiday events are bundled (phase 2a): Carnaval and Réveillon, day and night, and the fireworks", () => {
    expect(RIO_MAP.events.map((e) => e.key)).toEqual(["carnaval", "reveillon"]);
    for (const e of RIO_MAP.events) {
      for (const f of [...Object.values(e.layers), ...(e.animation?.night.frames ?? [])]) expect(rioUrl(`day1/map/${f}`), f).not.toBe("");
    }
    expect(RIO_MAP.events[1]!.animation!.night.frames).toHaveLength(4);
  });
});

const NEW_SCENES: SceneId[] = [
  "zona-sul/outside", "zona-sul/inside", "jardim-botanico/outside", "jardim-botanico/inside", "quilo/outside", "quilo/inside",
  "sult/outside", "sult/inside", "os-esquilos/outside", "os-esquilos/inside", "santa-teresa/outside", "santa-teresa/inside",
];

describe("phase 2a: the areas drawn since phase 1", () => {
  it("each new scene has every state in day, rain and night, and its falling rain", () => {
    for (const id of NEW_SCENES) {
      const s = SCENES[id];
      expect(Object.keys(s.base).length, id).toBeGreaterThanOrEqual(2);
      for (const [state, looks] of Object.entries(s.base)) for (const look of LOOKS) expect(rioUrl(looks[look] ?? ""), `${id} ${state} ${look}`).not.toBe("");
      expect(s.rainOverlay, id).toBeTruthy();
      expect(s.slots.length, id).toBeGreaterThan(0);
    }
    expect(Object.keys(SCENES["zona-sul/inside"].base)).toEqual(["start", "mid", "full"]);
  });

  it("reads each area's own sticker slots (slots or sticker_slots), ordered slots first", () => {
    expect(SCENES["jardim-botanico/outside"].slots).toHaveLength(23);
    expect(SCENES["jardim-botanico/inside"].slots).toHaveLength(17);
    expect(SCENES["zona-sul/outside"].slots).toHaveLength(13);
    expect(SCENES["quilo/inside"].slots).toHaveLength(4);
    expect(SCENES["sult/inside"].slots[0]!.id).toBe("celebration-table");
    expect(SCENES["sult/inside"].slots[0]!.order).toBe(1);
    expect(SCENES["santa-teresa/inside"].slots.find((s) => s.id === "window-seat")!.requires).toBe("window-seat");
    // Phase-1 slots files have no order: their slots keep file order.
    expect(SCENES["fazenda/outside"].slots.every((s) => s.order === undefined)).toBe(true);
  });

  it("Os Esquilos has its five celebration layers in each look, in step order", () => {
    for (const id of ["os-esquilos/outside", "os-esquilos/inside"] as SceneId[]) {
      const c = SCENES[id].celebrations!;
      expect(c.map((x) => x.id)).toEqual(["feast-table", "lanterns", "flowers", "roast", "cake"]);
      for (const x of c) for (const look of LOOKS) expect(rioUrl(x.layers[look] ?? ""), `${id} ${x.id} ${look}`).not.toBe("");
    }
  });

  it("Santa Teresa has its milestones, 204 spines and 9 covers", () => {
    const st = SCENES["santa-teresa/inside"];
    expect(st.milestones!.map((m) => m.id)).toEqual(["reading-lamp", "second-bookcase", "rug", "cat-bed", "window-seat"]);
    for (const m of st.milestones!) for (const look of LOOKS) expect(rioUrl(m.overlay[look] ?? ""), `${m.id} ${look}`).not.toBe("");
    expect(st.books!.spines.slots).toHaveLength(204);
    expect(st.books!.covers.slots).toHaveLength(9);
    expect(st.books!.spines.slots[142]).toMatchObject({ n: 143, requires: "second-bookcase" });
    expect(st.books!.spines.slots[0]).toMatchObject({ n: 1, x: 54, y: 68, w: 3, h: 10, sx: 0, sy: 0 });
    for (const sheet of [st.books!.spines, st.books!.covers]) for (const look of LOOKS) expect(rioUrl(sheet.sheets[look] ?? "")).not.toBe("");
  });

  it("the boteco's themed nights are bundled, with their posters", () => {
    expect(Object.keys(BOTECO_NIGHTS).sort()).toEqual(["football", "funk", "karaoke", "samba"]);
    for (const [k, n] of Object.entries(BOTECO_NIGHTS)) {
      expect(rioUrl(n.poster), k).not.toBe("");
      for (const side of [n.inside, n.outside]) {
        expect(rioUrl(side.overlay), `${k} overlay`).not.toBe("");
        for (const a of side.anims) expect(rioUrl(a.strip), `${k} ${a.strip}`).not.toBe("");
      }
    }
    expect(BOTECO_NIGHTS.football.inside.baseTv).toBe(false);
    expect(BOTECO_NIGHTS.samba.inside.baseTv).toBe(true);
    expect(BOTECO_NIGHTS.karaoke.inside.anims.find((a) => a.once)!.frames).toBe(5);
  });

  it("no dish, ingredient or new sticker art is bundled yet (phase 2b)", () => {
    expect(Object.keys(import.meta.glob("../assets/rio/**/dishes/**"))).toEqual([]);
    expect(Object.keys(import.meta.glob("../assets/rio/**/ingredients/**"))).toEqual([]);
    expect(Object.keys(import.meta.glob("../assets/rio/{week2,later}/*/stickers/**"))).toEqual([]);
  });
});

describe("the new sea off Arpoador replaces the rough first sea", () => {
  const sea = SCENES["ipanema-beach/sea"];
  it("reads the arpoador art: start and full in each look, 18 slots, its rain and its caustics", () => {
    expect(sea.base.start!.night).toBe("later/arpoador-sea/scenes/arpoador-sea-start-night.png");
    expect(Object.keys(sea.base)).toEqual(["start", "full"]);
    expect(sea.slots).toHaveLength(18);
    expect(sea.rainOverlay!.strip!.file).toBe("later/arpoador-sea/overlays/arpoador-rain.png");
    expect(sea.underlay!.count).toBe(4);
    expect(sea.underlay!.ms).toBe(160);
    for (const state of ["start", "full"]) for (const look of LOOKS) expect(rioUrl(sea.underlay!.strips[state]![look]!), `${state} ${look}`).not.toBe("");
  });
});

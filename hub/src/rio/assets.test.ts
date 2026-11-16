import { LOOKS, RIO_MAP, SCENES, mapLayer, rioUrl, type SceneId } from "./assets";

describe("the Rio art pack is bundled", () => {
  it("every map layer file is bundled", () => {
    for (const p of [...RIO_MAP.places, RIO_MAP.boat_route]) {
      for (const look of ["day", "night"] as const) {
        for (const state of ["open", "locked"] as const) {
          const path = p.layers[look][state];
          expect(rioUrl(`day1/map/${path}`), `${p.key} ${state} ${look}`).not.toBe("");
        }
      }
    }
    for (const m of ["locked", "new", "here", "stuck"] as const) expect(rioUrl(`day1/map/${RIO_MAP.markers[m].file}`)).not.toBe("");
    for (const look of ["day", "night"] as const) expect(rioUrl(`day1/map/${RIO_MAP.look_files[look]!.base}`)).not.toBe("");
  });

  it("every scene base file is bundled", () => {
    const ids = Object.keys(SCENES) as SceneId[];
    expect(ids.length).toBe(14);
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

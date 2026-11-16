import { AREA_SCENES, areaStatuses, opensOn } from "./areas";
import { RIO_MAP } from "./assets";

const none = new Set<string>();
const keys = RIO_MAP.places.map((p) => p.key);

describe("which areas are open", () => {
  it("day 1, nothing visited: the three day-one areas are new, Barraca is next, the rest locked", () => {
    const s = areaStatuses(1, none);
    expect(s.get("lagoa-house")).toBe("new");
    expect(s.get("fazenda")).toBe("new");
    expect(s.get("ipanema-beach")).toBe("new");
    expect(s.get("barraca")).toBe("next");
    for (const k of keys.filter((k) => !["lagoa-house", "fazenda", "ipanema-beach", "barraca"].includes(k))) {
      expect(s.get(k), k).toBe("locked");
    }
    expect(s.size).toBe(21);
  });

  it("day 1, those three visited: they are open", () => {
    const s = areaStatuses(1, new Set(["lagoa-house", "fazenda", "ipanema-beach"]));
    for (const k of ["lagoa-house", "fazenda", "ipanema-beach"]) expect(s.get(k)).toBe("open");
  });

  it("day 3: Barraca is new, the clothing store is next", () => {
    const s = areaStatuses(3, new Set(["lagoa-house", "fazenda", "ipanema-beach"]));
    expect(s.get("barraca")).toBe("new");
    expect(s.get("clothing-store")).toBe("next");
  });

  it("day 12: Zona Sul (no art yet) stays locked; next is the earliest area with art not yet open", () => {
    const s = areaStatuses(12, none);
    expect(s.get("zona-sul")).toBe("locked");
    expect(s.get("tijuca-park")).toBe("new");
    expect(s.get("boteco")).toBe("next");
  });

  it("Christ the Redeemer is never next or open while another area with an opening day is locked", () => {
    for (let day = 1; day <= 400; day++) {
      const s = areaStatuses(day, none);
      expect(["locked"]).toContain(s.get("christ-the-redeemer"));
    }
  });

  it("exactly one area is next on any day before every area with art is open; none after", () => {
    const lastArt = Math.max(...Object.keys(AREA_SCENES).map((k) => opensOn(k)!));
    for (let day = 1; day <= 200; day++) {
      const next = [...areaStatuses(day, none).values()].filter((v) => v === "next").length;
      expect(next, `day ${day}`).toBe(day < lastArt ? 1 : 0);
    }
  });

  it("opensOn: the day from map.json for areas with art; null for the last one and for areas without art", () => {
    expect(opensOn("barraca")).toBe(3);
    expect(opensOn("boteco")).toBe(45);
    expect(opensOn("christ-the-redeemer")).toBeNull();
    expect(opensOn("zona-sul")).toBeNull();
  });

  it("every area with art has an outside scene and its insides", () => {
    expect(AREA_SCENES["lagoa-house"]).toEqual({ outside: "lagoa-house/outside", inside: ["lagoa-house/living", "lagoa-house/bedroom", "lagoa-house/kitchen"] });
    expect(AREA_SCENES.fazenda).toEqual({ outside: "fazenda/outside", inside: [] });
    expect(AREA_SCENES.barraca).toEqual({ outside: "ipanema-beach/outside", inside: ["barraca/inside"] });
    expect(Object.keys(AREA_SCENES).sort()).toEqual(
      ["barraca", "boteco", "clothing-store", "fazenda", "ipanema-beach", "lagoa-house", "tijuca-park"],
    );
  });
});

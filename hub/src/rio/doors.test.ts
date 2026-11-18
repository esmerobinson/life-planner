import { AREA_SCENES } from "./areas";
import { SCENES, type SceneId } from "./assets";
import { SCENE_AREA, clearOfHotbar, doorsFor, resolveTo } from "./doors";

const ALL = Object.keys(SCENES) as SceneId[];
const targets = (s: SceneId) => doorsFor(s).map((d) => d.to ?? `menu:${d.opens}`);

describe("doors (Esme, 2026-11-17: \"hover and click on doors\", the exit is the way back to the map)", () => {
  it("every area's outside has a way back to the map", () => {
    for (const [area, { outside }] of Object.entries(AREA_SCENES)) expect(targets(outside), area).toContain("map");
  });

  it("every inside has a way back out, and every door leads somewhere real", () => {
    for (const s of ALL) {
      for (const d of doorsFor(s)) {
        expect(d.label, `${s} ${d.id}`).toMatch(/\w/);
        expect(d.rect.every((n) => Number.isFinite(n)), `${s} ${d.id}`).toBe(true);
        if (d.to && d.to !== "map") expect(SCENES[d.to], `${s} ${d.id} -> ${d.to}`).toBeDefined();
        else if (!d.to) expect(["noticeboard", "wardrobe"]).toContain(d.opens);
      }
    }
    for (const { outside, inside } of Object.values(AREA_SCENES)) {
      for (const s of inside) expect(doorsFor(s).some((d) => d.to === outside || (!!d.to && d.to !== "map" && SCENE_AREA[d.to] === SCENE_AREA[s] && d.to !== s)), s).toBe(true);
    }
  });

  it("the Lagoa house: the garden's doors go to each room and the gate to the map; no noticeboard there", () => {
    expect([...new Set(targets("lagoa-house/outside"))].sort()).toEqual(["lagoa-house/bedroom", "lagoa-house/kitchen", "lagoa-house/living", "map"]);
    expect(doorsFor("lagoa-house/outside").some((d) => d.opens === "noticeboard" || d.id === "noticeboard")).toBe(false);
    // Rooms connect through their own doors and stairs (the pack's redraw, 2026-11-17).
    expect(targets("lagoa-house/living")).toEqual(expect.arrayContaining(["lagoa-house/bedroom", "lagoa-house/kitchen", "lagoa-house/outside"]));
    expect(targets("lagoa-house/bedroom")).toEqual(expect.arrayContaining(["lagoa-house/living", "lagoa-house/outside"]));
    expect(targets("lagoa-house/kitchen")).toEqual(expect.arrayContaining(["lagoa-house/living", "lagoa-house/outside"]));
  });

  it("Ipanema: the noticeboard on the promenade, the barraca, the sea and the street back to the map", () => {
    const d = doorsFor("ipanema-beach/outside");
    expect(d.find((x) => x.opens === "noticeboard")?.rect).toEqual([74, 23, 28, 32]);
    expect(targets("ipanema-beach/outside")).toEqual(expect.arrayContaining(["barraca/inside", "ipanema-beach/sea", "map"]));
    expect(targets("barraca/inside")).toEqual(["ipanema-beach/outside"]);
    expect(targets("ipanema-beach/sea")).toEqual(["ipanema-beach/outside"]);
  });

  it("the store's fitting room opens the wardrobe; the fazenda's barn, coop and greenhouse doors wait for their insides", () => {
    expect(doorsFor("clothing-store/inside").find((d) => d.id === "fitting_room")).toMatchObject({ to: null, opens: "wardrobe" });
    expect(targets("fazenda/outside")).toEqual(["map"]);
  });

  it("the museum (no door data in its pack yet): the plaza's doors and stairs, the hall's notch", () => {
    expect(targets("museum/outside").sort()).toEqual(["map", "museum/inside"]);
    expect(targets("museum/inside")).toEqual(["museum/outside"]);
  });

  it("reads a door's target however the pack writes it", () => {
    expect(resolveTo("clothing-store/outside", "inside")).toEqual({ to: "clothing-store/inside" });
    expect(resolveTo("barraca/inside", "outside")).toEqual({ to: "ipanema-beach/outside" });
    expect(resolveTo("ipanema-beach/outside", "barraca-inside")).toEqual({ to: "barraca/inside" });
    expect(resolveTo("ipanema-beach/sea", "ipanema-beach")).toEqual({ to: "ipanema-beach/outside" });
    expect(resolveTo("lagoa-house/outside", "inside/living")).toEqual({ to: "lagoa-house/living" });
    expect(resolveTo("lagoa-house/outside", "bedroom")).toEqual({ to: "lagoa-house/bedroom" });
    expect(resolveTo("lagoa-house/outside", "lagoa-house/kitchen")).toEqual({ to: "lagoa-house/kitchen" });
    expect(resolveTo("zona-sul/outside", "map")).toEqual({ to: "map" });
    expect(resolveTo("clothing-store/inside", "fitting_room")).toEqual({ to: null, opens: "wardrobe" });
    expect(resolveTo("fazenda/outside", "barn")).toBeNull();
  });

  it("each scene belongs to an area (the beach to Ipanema, the barraca's inside to the barraca)", () => {
    expect(SCENE_AREA["ipanema-beach/outside"]).toBe("ipanema-beach");
    expect(SCENE_AREA["barraca/inside"]).toBe("barraca");
    expect(SCENE_AREA["lagoa-house/kitchen"]).toBe("lagoa-house");
    for (const s of ALL) expect(SCENE_AREA[s], s).toBeTruthy();
  });
});

describe("clearOfHotbar: a door under the hotbar reaches up above it", () => {
  const bar = { left: 591, right: 849, top: 816 };
  it("a bottom-centre door under the bar grows upward so part of it shows above", () => {
    expect(clearOfHotbar({ x: 647, y: 815, w: 146, h: 73 }, bar, 24)).toEqual({ x: 647, y: 792, w: 146, h: 96 });
  });
  it("a door clear of the bar is left alone", () => {
    expect(clearOfHotbar({ x: 100, y: 815, w: 146, h: 73 }, bar, 24)).toEqual({ x: 100, y: 815, w: 146, h: 73 });
    expect(clearOfHotbar({ x: 647, y: 300, w: 146, h: 73 }, bar, 24)).toEqual({ x: 647, y: 300, w: 146, h: 73 });
  });
});

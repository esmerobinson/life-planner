import { COLLECTION, STICKERS } from "../farm/catalogue";
import { farmState, placedRow } from "../farm/state";
import { SCENES } from "./assets";
import { HOME, accepts, freeSlotsFor, homeOf, layout, sceneState, slotsIn, stickerTags } from "./placement";

const keysIn = (group: string) => COLLECTION.filter((s) => s.group === group).map((s) => s.key);

describe("where earned stickers sit", () => {
  it("every collection sticker's group has a HOME entry (null allowed)", () => {
    for (const s of STICKERS) expect(s.group in HOME, s.group).toBe(true);
  });

  it("each phase-1 zone goes to the area that took it over", () => {
    expect(homeOf("seeds-mind")).toEqual({ area: "fazenda", scene: "fazenda/outside" });
    expect(homeOf("hen")).toEqual({ area: "fazenda", scene: "fazenda/outside" });
    expect(homeOf("daisy")).toEqual({ area: "tijuca-park", scene: "tijuca-park/outside" });
    expect(homeOf("hi")).toEqual({ area: "lagoa-house", scene: "lagoa-house/outside" }); // Kind notes
    const hedgerow = COLLECTION.find((s) => s.group === "lane" && s.set === "Hedgerow")!.key;
    expect(homeOf(hedgerow)).toEqual({ area: "tijuca-park", scene: "tijuca-park/inside" });
    expect(homeOf("lilypad")).toEqual({ area: "ipanema-beach", scene: "ipanema-beach/outside" });
    expect(homeOf(keysIn("aquarium")[0]!)).toEqual({ area: "ipanema-beach", scene: "ipanema-beach/sea" });
    expect(homeOf(keysIn("farmhouse")[0]!)).toEqual({ area: "boteco", scene: "boteco/inside" });
    // The Flamengo match takes over the theatre family (no phase-1 zone): the farmhouse stays at the boteco.
    expect(homeOf("lantern")).toEqual({ area: "boteco", scene: "boteco/inside" });
    expect(homeOf("cleared-mind")).toBeNull(); // bonus
    expect(homeOf("no-such-sticker")).toBeNull();
  });

  it("museum stickers are displayed in the museum's hall (day 21), every one on a display slot", () => {
    const museum = keysIn("museum");
    expect(homeOf("ammonite")).toEqual({ area: "museum", scene: "museum/inside" });
    expect(homeOf("pressed-daisy")).toEqual({ area: "museum", scene: "museum/inside" });
    const { bySlot, overflow } = layout("museum/inside", museum);
    expect(bySlot.size).toBe(museum.length);
    expect(overflow).toBe(0);
  });

  it("a bonus sticker has no home and no slot (it stays in the collection)", () => {
    for (const id of Object.keys(SCENES)) {
      const { bySlot } = layout(id as keyof typeof SCENES, ["cleared-mind"]);
      expect([...bySlot.values()]).not.toContain("cleared-mind");
    }
  });

  it("the sea off Arpoador: stream fish swim, the two workbook fish take the rare showcase", () => {
    const fish = keysIn("aquarium");
    const { bySlot, overflow } = layout("ipanema-beach/sea", fish);
    expect(overflow).toBe(0);
    for (const [slot, key] of bySlot) {
      if (key === "moonfish" || key === "golden-carp") expect(slot, key).toMatch(/^rare-/);
      else expect(slot, key).toMatch(/^swim-/);
    }
    expect(bySlot.size).toBe(fish.length);
  });

  it("orchard trees stand outside the Jardim Botanico, the glasshouse in its orchid house", () => {
    expect(homeOf("sapling")).toEqual({ area: "jardim-botanico", scene: "jardim-botanico/outside" });
    expect(homeOf("tree-swing")).toEqual({ area: "jardim-botanico", scene: "jardim-botanico/outside" });
    expect(homeOf("orchid")).toEqual({ area: "jardim-botanico", scene: "jardim-botanico/inside" });
    expect(homeOf("seedtray")).toEqual({ area: "jardim-botanico", scene: "jardim-botanico/inside" });
  });

  it("every orchard sticker stands on a tree slot only: 7 spots, 2 wait in the collection", () => {
    const orchard = keysIn("orchard");
    expect(orchard).toHaveLength(9);
    const { bySlot, overflow } = layout("jardim-botanico/outside", orchard);
    const at = new Map(SCENES["jardim-botanico/outside"].slots.map((s) => [s.id, s]));
    for (const slot of bySlot.keys()) expect(at.get(slot)!.accepts, slot).toEqual(["trees:tree"]);
    expect(bySlot.size).toBe(7);
    expect(overflow).toBe(2);
  });

  it("review I2: the orchid house puts each glasshouse sticker where the pack meant it (bench, floor tubs), never in the pools", () => {
    const { bySlot } = layout("jardim-botanico/inside", keysIn("glasshouse"));
    expect(bySlot.get("potting-bench")).toBe("seedtray");
    expect(["floor-left", "floor-right"].map((s) => bySlot.get(s)).sort()).toEqual(["fig-tree", "lemontree"]);
    expect(bySlot.has("pool-1")).toBe(false);
    expect(bySlot.has("pool-2")).toBe(false);
    // Phase-1 scenes keep their layout: the preference is the Jardim's alone.
    expect(layout("fazenda/outside", ["haybale", "seeds-art", "seeds-mind"]).bySlot.get("decor-veranda-1")).toBe("seeds-mind");
  });

  it("the glasshouse fills the orchid house, each on a slot that takes its kind", () => {
    const glass = keysIn("glasshouse");
    const { bySlot, overflow } = layout("jardim-botanico/inside", glass);
    const at = new Map(SCENES["jardim-botanico/inside"].slots.map((s) => [s.id, s]));
    for (const [slot, key] of bySlot) expect(accepts(at.get(slot)!, stickerTags(key)), `${slot} ${key}`).toBe(true);
    // The seed tray, seedling and can only where seeds or any orchid-house sticker go (never a hook or the pool).
    for (const k of ["seedtray", "seedling", "wateringcan"]) {
      const slot = [...bySlot].find(([, v]) => v === k)![0];
      expect(at.get(slot)!.accepts.some((a) => a === "greenhouse:seeds" || a === "greenhouse:*"), `${k} on ${slot}`).toBe(true);
    }
    expect(bySlot.size).toBe(12);
    expect(overflow).toBe(0);
    expect(stickerTags("orchid")).toEqual(["greenhouse:plant"]);
    expect(stickerTags("wateringcan")).toEqual(["greenhouse:seeds"]);
  });

  it("an orchard sticker placed back in phase 1 (old spot id) stands at the Jardim Botanico", () => {
    const old = farmState([placedRow("sapling", "sapling", "2026-11-05")]);
    expect([...layout("jardim-botanico/outside", [...old.placed.keys()]).bySlot.values()]).toEqual(["sapling"]);
  });

  it("a slot that needs a milestone is free only once it is earned (Santa Teresa's window seat)", () => {
    const free = (m: string[]) => slotsIn("santa-teresa/inside", "start", m).map((s) => s.id);
    expect(free([])).not.toContain("window-seat");
    expect(free([])).not.toContain("bookcase-2-top");
    expect(free(["window-seat"])).toContain("window-seat");
  });

  it("layout fills the slots that take them, in book order", () => {
    const { bySlot, overflow } = layout("fazenda/outside", ["haybale", "seeds-art", "seeds-mind"]);
    expect(bySlot.get("decor-veranda-1")).toBe("seeds-mind");
    expect(bySlot.get("decor-veranda-2")).toBe("seeds-art");
    expect(bySlot.get("decor-yard-1")).toBe("haybale");
    expect(bySlot.size).toBe(3);
    expect(overflow).toBe(0);
  });

  it("a sticker only stands in a slot that takes it (review: no seeds on the hen's spot, no pile-up on the egg slots)", () => {
    const { bySlot } = layout("fazenda/outside", ["seeds-mind", "hen", "chick", "cow", "lamb", "piglet"]);
    expect(bySlot.get("hen-1")).toBe("hen");
    expect(bySlot.get("chick-1")).toBe("chick");
    expect(bySlot.get("cow-1")).toBe("cow");
    expect(bySlot.get("sheep-1")).toBe("lamb");
    expect(bySlot.get("pig-1")).toBe("piglet");
    expect(bySlot.get("decor-veranda-1")).toBe("seeds-mind");
    const all = layout("fazenda/outside", COLLECTION.map((s) => s.key)).bySlot;
    for (const id of ["egg-1", "egg-2", "egg-3", "tool-hook-1", "tool-hook-2", "milk-1", "wool-1"]) expect(all.has(id), id).toBe(false);
    // Ipanema: pond life on the sand and rocks, never on the barraca's chair spots.
    const beach = layout("ipanema-beach/outside", COLLECTION.map((s) => s.key)).bySlot;
    for (const id of ["barraca-1", "barraca-2", "barraca-3", "barraca-4"]) expect(beach.has(id), id).toBe(false);
  });

  it("every sticker laid out, in every scene, stands in a slot whose accepts take it", () => {
    for (const id of Object.keys(SCENES) as (keyof typeof SCENES)[]) {
      const at = new Map(SCENES[id].slots.map((s) => [s.id, s]));
      const raw = SCENES[id].slots;
      for (const [slot, key] of layout(id, COLLECTION.map((s) => s.key)).bySlot) {
        expect(raw.some((s) => s.id === slot)).toBe(true);
        expect(accepts(at.get(slot)!, stickerTags(key)), `${id} ${slot} ${key}`).toBe(true);
      }
    }
  });

  it("layout places only the scene's own stickers", () => {
    const { bySlot } = layout("fazenda/outside", ["seeds-mind", "lilypad", "daisy"]);
    expect([...bySlot.values()]).toEqual(["seeds-mind"]);
  });

  it("overflow counts the extras: every beds and barnyard sticker at the fazenda", () => {
    const all = [...keysIn("beds"), ...keysIn("barnyard")];
    expect(all.length).toBe(68);
    const { bySlot, overflow } = layout("fazenda/outside", all);
    // 6 animals on their own spots (hen, chick, cow, sheep and lamb, piglet) and the 8 general spots.
    expect(bySlot.size).toBe(14);
    expect(overflow).toBe(68 - 14);
  });

  it("layout ignores the stored spot: an old phase-1 spot id never moves a sticker", () => {
    const old = farmState([placedRow("seeds-mind", "seeds-mind", "2026-11-05"), placedRow("hen", "hen", "2026-11-05")]);
    const fresh = farmState([placedRow("seeds-mind", "rio", "2026-11-14"), placedRow("hen", "rio", "2026-11-14")]);
    expect(layout("fazenda/outside", [...old.placed.keys()]).bySlot).toEqual(layout("fazenda/outside", [...fresh.placed.keys()]).bySlot);
  });

  it("state-only slots are used only in their state", () => {
    // The living room's table tops are free only once the room is full.
    const living = SCENES["lagoa-house/living"];
    const fullOnly = living.slots.filter((s) => s.state === "full").map((s) => s.id);
    expect(fullOnly.length).toBeGreaterThan(0);
    // No phase-1 sticker lives in the living room, so nothing is laid out there.
    expect(layout("lagoa-house/living", ["seeds-mind"]).bySlot.size).toBe(0);
  });

  it("sceneState: start until half the slots are filled, then full; Ipanema in three stages", () => {
    const n = SCENES["fazenda/outside"].slots.length;
    expect(sceneState("fazenda/outside", 0)).toBe("start");
    expect(sceneState("fazenda/outside", Math.ceil(n / 2) - 1)).toBe("start");
    expect(sceneState("fazenda/outside", Math.ceil(n / 2))).toBe("full");
    const m = SCENES["ipanema-beach/outside"].slots.length;
    expect(sceneState("ipanema-beach/outside", 0)).toBe("stage1");
    expect(sceneState("ipanema-beach/outside", Math.ceil(m / 3))).toBe("stage2");
    expect(sceneState("ipanema-beach/outside", m)).toBe("stage3");
    expect(sceneState("ipanema-beach/outside", m + 5)).toBe("stage3");
  });
});

describe("moving a placed sticker (Esme, 2026-11-17: \"Items should be movable\")", () => {
  it("a sticker's chosen slot comes first; the rest fill the free slots in book order", () => {
    const plain = layout("fazenda/outside", ["hen", "cow"]);
    expect(plain.bySlot.get("hen-1")).toBe("hen");
    expect(plain.bySlot.get("cow-1")).toBe("cow");
    const moved = layout("fazenda/outside", ["hen", "cow"], [], new Map([["hen", "hen-3"], ["cow", "cow-2"]]));
    expect(moved.bySlot.get("hen-3")).toBe("hen");
    expect(moved.bySlot.get("cow-2")).toBe("cow");
    expect(moved.bySlot.has("hen-1")).toBe(false);
  });

  it("a chosen slot that's gone, taken, or doesn't take the sticker is ignored: it falls back to book order, never vanishes", () => {
    for (const slot of ["no-such-slot", "cow-1"]) {
      const l = layout("fazenda/outside", ["hen"], [], new Map([["hen", slot]]));
      expect([...l.bySlot.values()], slot).toEqual(["hen"]);
      expect(l.bySlot.get("hen-1")).toBe("hen");
    }
    // Two stickers chose the same slot: the first in book order keeps it, the other goes to the next free one.
    const both = layout("fazenda/outside", ["hen", "chick"].filter((k) => k === "hen"), [], new Map([["hen", "hen-2"]]));
    expect(both.bySlot.get("hen-2")).toBe("hen");
  });

  it("where a placed sticker can move: the free slots of its scene that take it (not its own, not taken)", () => {
    const placed = ["hen", "cow"];
    expect(freeSlotsFor("fazenda/outside", "hen", placed).map((s) => s.id)).toEqual(["hen-2", "hen-3", "hen-4"]);
    expect(freeSlotsFor("fazenda/outside", "cow", placed).map((s) => s.id)).toEqual(["cow-2"]);
    expect(freeSlotsFor("fazenda/outside", "cow", placed, [], new Map([["cow", "cow-2"]])).map((s) => s.id)).toEqual(["cow-1"]);
  });
});

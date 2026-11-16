import { COLLECTION, STICKERS } from "../farm/catalogue";
import { farmState, placedRow } from "../farm/state";
import { SCENES } from "./assets";
import { HOME, accepts, homeOf, layout, sceneState, stickerTags } from "./placement";

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
    expect(homeOf("cleared-mind")).toBeNull(); // bonus
    expect(homeOf("no-such-sticker")).toBeNull();
  });

  it("a placed orchard sticker has no home and no slot (it stays in the book)", () => {
    const orchard = keysIn("orchard")[0]!;
    expect(homeOf(orchard)).toBeNull();
    for (const id of Object.keys(SCENES)) {
      const { bySlot } = layout(id as keyof typeof SCENES, [orchard]);
      expect([...bySlot.values()]).not.toContain(orchard);
    }
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

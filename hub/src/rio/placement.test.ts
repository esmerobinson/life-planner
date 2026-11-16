import { COLLECTION, STICKERS } from "../farm/catalogue";
import { farmState, placedRow } from "../farm/state";
import { SCENES } from "./assets";
import { HOME, homeOf, layout, sceneState } from "./placement";

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

  it("layout fills slots in book order", () => {
    const slots = SCENES["fazenda/outside"].slots;
    const { bySlot, overflow } = layout("fazenda/outside", ["hen", "seeds-art", "seeds-mind"]);
    expect(bySlot.get(slots[0]!.id)).toBe("seeds-mind");
    expect(bySlot.get(slots[1]!.id)).toBe("seeds-art");
    expect(bySlot.get(slots[2]!.id)).toBe("hen");
    expect(bySlot.size).toBe(3);
    expect(overflow).toBe(0);
  });

  it("layout places only the scene's own stickers", () => {
    const { bySlot } = layout("fazenda/outside", ["seeds-mind", "lilypad", "daisy"]);
    expect([...bySlot.values()]).toEqual(["seeds-mind"]);
  });

  it("overflow counts the extras: every beds and barnyard sticker at the fazenda", () => {
    const all = [...keysIn("beds"), ...keysIn("barnyard")];
    expect(all.length).toBe(68);
    const slots = SCENES["fazenda/outside"].slots.length;
    const { bySlot, overflow } = layout("fazenda/outside", all);
    expect(bySlot.size).toBe(slots);
    expect(overflow).toBe(68 - slots);
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

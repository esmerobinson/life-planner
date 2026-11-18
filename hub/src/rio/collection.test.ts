import { COLLECTION, STICKERS } from "../farm/catalogue";
import { areaOfSticker, cellState, COLLECTION_AREAS } from "./collection";
import { homeOf } from "./placement";

// The Collection tab: her stickers grouped by Rio area (it replaces the sticker book; nothing is lost).

const all = COLLECTION_AREAS.flatMap((a) => a.pages.flatMap((p) => p.stickers));

it("every sticker is on exactly one page: the 175 and the 8 bonus", () => {
  expect(all).toHaveLength(STICKERS.length);
  expect(new Set(all).size).toBe(STICKERS.length);
  expect(STICKERS.length).toBe(COLLECTION.length + 8);
  expect(COLLECTION).toHaveLength(175);
});

it("the areas come in opening order, with the bonus page last", () => {
  expect(COLLECTION_AREAS.map((a) => a.key)).toEqual([
    "lagoa-house", "fazenda", "ipanema-beach", "tijuca-park", "jardim-botanico", "museum", "boteco", "bonus",
  ]);
  expect(COLLECTION_AREAS.find((a) => a.key === "fazenda")!.pages.map((p) => p.title)).toEqual(["Vegetable beds", "Barnyard"]);
});

it("no page holds more than the grid shows (10 x 6)", () => {
  for (const a of COLLECTION_AREAS) for (const p of a.pages) expect(p.stickers.length).toBeLessThanOrEqual(60);
});

it("a sticker sits under the Rio area that is its home", () => {
  for (const k of all) {
    const home = homeOf(k);
    if (home) expect(areaOfSticker(k)).toBe(home.area);
  }
  expect(areaOfSticker("hen")).toBe("fazenda");
  expect(areaOfSticker(COLLECTION.find((s) => s.group === "orchard")!.key)).toBe("jardim-botanico");
});

it("pages keep book order", () => {
  for (const a of COLLECTION_AREAS) for (const p of a.pages) {
    const idx = p.stickers.map((k) => STICKERS.findIndex((s) => s.key === k));
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  }
});

it("a cell is placed, ready to place, or not yet earned", () => {
  const view = { earnedSet: new Set(["hen", "cow"]), state: { placed: new Map([["hen", "rio"]]) } };
  expect(cellState("hen", view)).toBe("placed");
  expect(cellState("cow", view)).toBe("ready");
  expect(cellState("sheep", view)).toBe("ghost");
});

it("an earned Kind note is kept in the Collection (no \"!\": it has no place in a scene), placed before or not", () => {
  const view = (placed: string[]) => ({ earnedSet: new Set(["hi", "hen"]), state: { placed: new Map(placed.map((k) => [k, "rio"] as [string, string])) } });
  expect(cellState("hi", view([]))).toBe("kept");
  expect(cellState("hi", view(["hi"]))).toBe("kept");
  expect(cellState("hen", view([]))).toBe("ready");
  expect(cellState("ok", view([]))).toBe("ghost");
});

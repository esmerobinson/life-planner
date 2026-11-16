import { readdirSync } from "node:fs";
import { KIT, kitUrl } from "./kit";
import { glyphOf, measure, wrapText } from "./font";

// The approved UI kit (esme-ui) and its body pixel font, bundled.

const USED = [
  "panel", "inset", "tab", "tab-active", "tab-side", "tab-side-active", "btn-close", "btn-close-hover", "btn-arrow-left",
  "btn-arrow-right", "btn-text", "btn-text-hover", "slot", "slot-lg", "slot-lg-hover", "tooltip", "tooltip-divider", "emote-bang",
  "row", "row-hover", "icon-tick", "icon-frame", "badge-new", "ribbon-bow", "frame-thin", "fx-sparkle",
  "icon-map", "icon-book", "icon-noticeboard", "icon-wardrobe", "icon-friends", "icon-star",
];

it("every kit piece the menu uses is bundled, with its size", () => {
  for (const name of USED) {
    expect(kitUrl(name), name).not.toBe("");
    expect(KIT[name]?.w, name).toBeGreaterThan(0);
    expect(KIT[name]?.h, name).toBeGreaterThan(0);
  }
  expect(KIT.panel!.slice).toEqual([6, 7, 6, 6]);
});

it("only the kit's own pieces were copied (no screen-specific extras, no review files)", () => {
  const files = readdirSync("src/assets/rio-ui/kit");
  expect(files.some((f) => f.startsWith("extra-"))).toBe(false);
  expect(files.some((f) => /review|preview|sample/i.test(f))).toBe(false);
});

describe("the body pixel font", () => {
  it("measures by advance, less the last letter's spacing", () => {
    expect(measure("")).toBe(0);
    expect(measure("A")).toBe(5);
    expect(measure("AA")).toBe(11);
  });

  it("draws letters it lacks as their nearest glyph", () => {
    expect(glyphOf("â")).toBe(glyphOf("a"));
    expect(glyphOf("·")).toBe(glyphOf("•"));
    expect(glyphOf("›")).toBe(glyphOf(">"));
    expect(glyphOf("中")).toBe(glyphOf("?"));
  });

  it("wraps on words", () => {
    expect(wrapText("one two three", measure("one two"))).toEqual(["one two", "three"]);
    expect(wrapText("one\ntwo", 1000)).toEqual(["one", "two"]);
  });
});

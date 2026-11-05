import { totalPlate } from "./StickerBook";
import { drawBadge, textWidth, type Sheets } from "./sprites";
import { COLLECTION } from "./catalogue";

// The book's counts (fix round 1): the contents page's total plate reads "N OF 175" (the whole
// collection, never the bonus page), and a repeatable sticker carries the pack's ×N badge from ×2.

describe("the total plate", () => {
  it("reads N OF 175, centred on the plate and inside its ornaments", () => {
    expect(COLLECTION).toHaveLength(175);
    expect(totalPlate(0).text).toBe("0 OF 175");
    expect(totalPlate(37).text).toBe("37 OF 175");
    const all = totalPlate(175);
    expect(all.text).toBe("175 OF 175");
    expect(textWidth(all.text)).toBeLessThanOrEqual(41); // the manifest's max_text_width
    expect(all.x + Math.floor(textWidth(all.text) / 2)).toBe(116 + 56); // centred on text_centre_x, right page
  });
});

describe("the ×N badge", () => {
  const ctx = () => {
    const calls: unknown[][] = [];
    return { calls, ctx: { drawImage: (...a: unknown[]) => calls.push(a) } as unknown as CanvasRenderingContext2D };
  };
  const img = (name: string) => ({ name }) as unknown as HTMLImageElement;
  const sheets: Sheets = { "badge-count": img("badge"), "font-small": img("font") };

  it("isn't drawn for a sticker earned once", () => {
    const c = ctx();
    drawBadge(c.ctx, sheets, 0, 10, 10);
    drawBadge(c.ctx, sheets, 1, 10, 10);
    expect(c.calls).toHaveLength(0);
  });

  it("shows from ×2: the badge's caps around the digits, its bottom-right at the sticker's corner", () => {
    const c = ctx();
    drawBadge(c.ctx, sheets, 2, 10, 10);
    const badge = c.calls.filter((a) => a[0] === sheets["badge-count"]);
    const digits = c.calls.filter((a) => a[0] === sheets["font-small"]);
    expect(digits).toHaveLength(1);
    const right = badge[badge.length - 1]!;
    expect((right[5] as number) + (right[7] as number)).toBe(10 + 18); // dx + width: x + 18
    expect((right[6] as number) + (right[8] as number)).toBe(10 + 18); // dy + height: y + 18
  });

  it("grows with the number (×12 has two digits)", () => {
    const c = ctx();
    drawBadge(c.ctx, sheets, 12, 10, 10);
    expect(c.calls.filter((a) => a[0] === sheets["font-small"])).toHaveLength(2);
  });
});

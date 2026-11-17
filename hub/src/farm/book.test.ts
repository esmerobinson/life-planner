import { drawBadge, textWidth, type Sheets } from "./sprites";

// A repeatable sticker carries the pack's ×N badge from ×2 (fix round 1). The book itself is gone
// (Esme, 2026-11-17); its total lives on in the game menu's Collection (rio/menu).

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

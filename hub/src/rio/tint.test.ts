import { buildTint, cachedTint, recolour } from "./tint";

// Placed stickers take the look's colours (museum README: "Finds placed by the game as stickers
// are in day colours. They should be tinted with the same night/rain twin"). The twin of each day
// colour is read from the scene's own day and look pictures.

const px = (...cs: [number, number, number, number][]) => new Uint8ClampedArray(cs.flat());

describe("tinting placed stickers to the look", () => {
  it("each day colour maps to the look colour it most often becomes", () => {
    const day = px([10, 20, 30, 255], [10, 20, 30, 255], [10, 20, 30, 255], [200, 0, 0, 255], [0, 0, 0, 0]);
    const night = px([1, 2, 3, 255], [1, 2, 3, 255], [99, 99, 99, 255], [50, 0, 80, 255], [7, 7, 7, 255]);
    const t = buildTint(day, night);
    expect(t.get(0x0a141e)).toBe(0x010203);
    expect(t.get(0xc80000)).toBe(0x320050);
    expect(t.size).toBe(2); // transparent day pixels are skipped
  });

  it("recolours exact colours, keeps alpha, and leaves transparent pixels alone", () => {
    const t = new Map([[0x0a141e, 0x010203]]);
    const img = px([10, 20, 30, 255], [0, 0, 0, 0]);
    recolour(img, t);
    expect([...img]).toEqual([1, 2, 3, 255, 0, 0, 0, 0]);
  });

  it("a colour the scene lacks follows its nearest scene colour's change, channel by channel", () => {
    const t = new Map([[0x646464, 0x323264]]); // (100,100,100) -> (50,50,100)
    const img = px([110, 90, 100, 255]);
    recolour(img, t);
    expect([...img]).toEqual([55, 45, 100, 255]);
  });

  it("an empty twin changes nothing", () => {
    const img = px([110, 90, 100, 255]);
    recolour(img, new Map());
    expect([...img]).toEqual([110, 90, 100, 255]);
  });
});

it("review I1: a tinted sticker is built once per look and reused on every frame", () => {
  const build = vi.fn(() => ({}) as HTMLCanvasElement);
  const a = cachedTint("hall-day|hall-rain|ammonite", build);
  const b = cachedTint("hall-day|hall-rain|ammonite", build);
  expect(a).toBe(b);
  expect(build).toHaveBeenCalledTimes(1);
  cachedTint("hall-day|hall-night|ammonite", build);
  expect(build).toHaveBeenCalledTimes(2);
});

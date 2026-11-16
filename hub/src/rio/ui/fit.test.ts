import { bodyPx, headPx, MENU_STAGE, menuFit } from "./fit";

// The menu fits the window whole, at a whole-number scale (kit.json: 3x desktop, 2x phone).

it("a desktop window shows the wide panel at 3x", () => {
  expect(menuFit(1440, 900)).toEqual({ layout: "wide", u: 3 });
  expect(menuFit(1220, 820)).toEqual({ layout: "wide", u: 3 });
});

it("a short desktop window drops to 2x rather than scroll", () => {
  expect(menuFit(1280, 600)).toEqual({ layout: "wide", u: 2 });
});

it("a phone gets the narrow panel (the kit's phone screens) at 2x", () => {
  expect(menuFit(390, 760)).toEqual({ layout: "narrow", u: 2 });
});

it("a very small window still fits, at 1x as the last resort", () => {
  expect(menuFit(360, 640)).toEqual({ layout: "narrow", u: 1 });
  expect(menuFit(300, 400)).toEqual({ layout: "narrow", u: 1 });
});

it("every layout fits its window at the scale it picks", () => {
  for (const [w, h] of [[1440, 900], [1280, 600], [390, 760], [360, 640], [1024, 700]] as const) {
    const { layout, u } = menuFit(w, h);
    expect(MENU_STAGE[layout].w * u).toBeLessThanOrEqual(w);
    expect(MENU_STAGE[layout].h * u).toBeLessThanOrEqual(h);
  }
});

it("body text is 2 CSS px per font pixel at 3x, else the UI scale; headings at the UI scale", () => {
  expect(bodyPx(3)).toBe(2);
  expect(bodyPx(2)).toBe(2);
  expect(bodyPx(1)).toBe(1);
  expect(headPx(3)).toBe(3);
});

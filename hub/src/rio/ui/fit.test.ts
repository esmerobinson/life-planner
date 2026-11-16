import { bodyPx, headPx, MENU_STAGE, menuFit, stageOf } from "./fit";

// The menu fits the window whole, at a whole-number scale (kit.json: 3x desktop, 2x phone).

it("a desktop window shows the wide panel at 3x", () => {
  expect(menuFit(1440, 900)).toEqual({ layout: "wide", u: 3, short: false });
  expect(menuFit(1220, 820)).toEqual({ layout: "wide", u: 3, short: false });
});

it("a short desktop window drops to 2x rather than scroll", () => {
  expect(menuFit(1280, 600)).toEqual({ layout: "wide", u: 2, short: false });
});

it("a phone gets the narrow panel (the kit's phone screens) at 2x", () => {
  expect(menuFit(390, 760)).toEqual({ layout: "narrow", u: 2, short: false });
});

it("common phones narrower than 390 keep 2x (review I3): 375 and 360 wide", () => {
  expect(menuFit(375, 700)).toEqual({ layout: "narrow", u: 2, short: false });
  expect(menuFit(360, 640)).toEqual({ layout: "narrow", u: 2, short: false });
});

it("a short phone screen docks the card over the panel's foot instead of under it, and keeps 2x", () => {
  expect(menuFit(360, 560)).toEqual({ layout: "narrow", u: 2, short: true });
});

it("a very small window still fits, at 1x as the last resort", () => {
  expect(menuFit(300, 400)).toEqual({ layout: "narrow", u: 1, short: true });
});

it("every layout fits its window at the scale it picks", () => {
  for (const [w, h] of [[1440, 900], [1280, 600], [390, 760], [375, 600], [360, 640], [360, 520], [1024, 700]] as const) {
    const fit = menuFit(w, h);
    const st = stageOf(fit);
    expect(st.w * fit.u).toBeLessThanOrEqual(w);
    expect(st.h * fit.u).toBeLessThanOrEqual(h);
  }
  expect(MENU_STAGE.narrow.w).toBeLessThanOrEqual(180);
});

it("body text is 2 CSS px per font pixel at 3x, else the UI scale; headings at the UI scale", () => {
  expect(bodyPx(3)).toBe(2);
  expect(bodyPx(2)).toBe(2);
  expect(bodyPx(1)).toBe(1);
  expect(headPx(3)).toBe(3);
});

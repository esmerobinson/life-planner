import { bodyPx, headPx, MENU_STAGE, menuFit, stageOf } from "./fit";

// The menu fits the window whole, at a whole-number scale (kit.json: 3x desktop, 2x phone).

it("a desktop window shows the wide panel at 3x", () => {
  expect(menuFit(1440, 900)).toMatchObject({ layout: "wide", u: 3, short: false });
  expect(menuFit(1220, 820)).toMatchObject({ layout: "wide", u: 3, short: false });
});

it("a short desktop window drops to 2x rather than scroll", () => {
  expect(menuFit(1280, 600)).toMatchObject({ layout: "wide", u: 2, short: false });
});

it("a phone gets the narrow panel (the kit's phone screens) at 2x", () => {
  expect(menuFit(390, 760)).toMatchObject({ layout: "narrow", u: 2, short: false });
});

it("common phones narrower than 390 keep 2x (review I3): 375 and 360 wide", () => {
  expect(menuFit(375, 700)).toMatchObject({ layout: "narrow", u: 2, short: false });
  expect(menuFit(360, 640)).toMatchObject({ layout: "narrow", u: 2, short: false });
});

it("a short phone screen docks the card over the panel's foot instead of under it, and keeps 2x", () => {
  expect(menuFit(360, 560)).toMatchObject({ layout: "narrow", u: 2, short: true });
});

it("a very small window still fits, at 1x as the last resort", () => {
  expect(menuFit(300, 400)).toMatchObject({ layout: "narrow", u: 1, short: true });
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

it("body text is two thirds of the UI scale on the desktop (2 at 3x), the UI scale on the phone; headings at the UI scale", () => {
  expect(bodyPx(3, "wide")).toBe(2);
  expect(bodyPx(4.5, "wide")).toBe(3);
  expect(bodyPx(2, "narrow")).toBe(2);
  expect(bodyPx(1, "narrow")).toBe(1);
  expect(headPx(3)).toBe(3);
});

it("the desktop menu grows to the largest size that fits the window, fractions allowed; the phone's stays whole", () => {
  for (const [w, h] of [[1440, 900], [1280, 800], [2560, 1080]] as const) {
    const f = menuFit(w, h);
    expect(f.menuU).toBeGreaterThan(f.u);
    expect(MENU_STAGE.wide.w * f.menuU).toBeLessThanOrEqual(w + 1e-6);
    expect(MENU_STAGE.wide.h * f.menuU).toBeLessThanOrEqual(h + 1e-6);
    expect(Math.max(MENU_STAGE.wide.w * f.menuU - w, MENU_STAGE.wide.h * f.menuU - h)).toBeCloseTo(0, 6);
  }
  expect(menuFit(390, 760).menuU).toBe(2);
});

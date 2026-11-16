// Esme's Rio: the menu's size. Everything in the menu is laid out in UI pixels (1em = 1 UI pixel,
// as the kit's mockups do) and shown at a whole-number scale `u` (kit.json: "3x desktop, 2x phone").
// The panel is the kit's one menu-with-tabs screen (esme-ui src/screens_c_more.js skillsHTML):
// desktop 254x178 with the tabs 12 in and 15 above it and the close button 26 above; the phone's
// is 191 wide. The wide stage keeps 15 to the left for the Collection's side tabs; the narrow one
// keeps the phone Collection's card dock under the panel (screens_a_book.js: tipdock, 4 + 70).

import { createContext, useContext } from "react";

export type MenuLayout = "wide" | "narrow";

export interface Box { x: number; y: number; w: number; h: number }

export const MENU_STAGE: Record<MenuLayout, { w: number; h: number; panel: Box; dock?: Box }> = {
  wide: { w: 269, h: 204, panel: { x: 15, y: 26, w: 254, h: 178 } },
  narrow: { w: 195, h: 304, panel: { x: 2, y: 16, w: 191, h: 214 }, dock: { x: 2, y: 234, w: 191, h: 70 } },
};

const fits = (layout: MenuLayout, u: number, vw: number, vh: number) =>
  MENU_STAGE[layout].w * u <= vw && MENU_STAGE[layout].h * u <= vh;

/** The layout and whole-number scale at which the menu fits a `vw` x `vh` CSS px box. */
export function menuFit(vw: number, vh: number): { layout: MenuLayout; u: number } {
  for (const u of [3, 2]) if (fits("wide", u, vw, vh)) return { layout: "wide", u };
  for (const u of [3, 2]) if (fits("narrow", u, vw, vh)) return { layout: "narrow", u };
  return { layout: "narrow", u: 1 };
}

/** CSS px per font pixel for body text (core.js: 2 on the 3x desktop, the UI scale on phones). */
export const bodyPx = (u: number): number => (u === 3 ? 2 : u);
/** CSS px per font pixel for a heading (core.js: "d" draws at the UI scale). */
export const headPx = (u: number): number => u;

export const UiContext = createContext<{ u: number; layout: MenuLayout }>({ u: 2, layout: "wide" });
export const useUi = () => useContext(UiContext);

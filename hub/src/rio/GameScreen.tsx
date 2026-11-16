// Esme's Rio: the game screen (Esme, 2026-11-17: "it should be like a fixed screen idk with no
// scrolling; just needs better design"). The one place the game's frame lives: it fills the
// content area beside the sidebar (on the phone, under the phone header), never scrolls, and the
// kit's wooden planks fill the edges round the art (Esme's option A, 2026-11-17). It works out the UI's whole-number scale and layout
// for everything drawn over the game (ui/fit.ts). Restyle the frame in game-screen.css.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "../farm/hooks";
import { kitVars } from "./menu/pieces";
import { UiContext, menuFit } from "./ui/fit";
import "./menu/menu.css";
import "./game-screen.css";

export function GameScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const still = useReducedMotion();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);

  // The test DOM has no layout (0 x 0): use the window there.
  const w = size?.w || window.innerWidth;
  const h = size?.h || window.innerHeight;
  const fit = menuFit(w, h);

  return (
    <div ref={ref} className={`game-screen rio-ui${still ? " is-still" : ""}`} data-layout={fit.layout} data-u={fit.u}
      style={{ ...kitVars(), ["--u" as string]: `${fit.u}px` }}>
      <UiContext.Provider value={fit}>{children}</UiContext.Provider>
    </div>
  );
}

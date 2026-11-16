// Esme's Rio: the game screen. Esme, 2026-11-17: "The full screen game is best; i think it should
// be truly full screen with a small border though not just at top and bottom. and then have a
// back button at the top keep the rest of app UI the same". The one place the game's frame lives:
// on /farm it takes the whole window (the shell leaves out its own chrome there, ui/AppShell.tsx),
// with an even border of the kit's wooden planks on all four sides (--game-border, game-screen.css;
// not final), and the view inside it, which the map or area covers (canvas.ts useCover). It works
// out the UI's whole-number scale and layout for everything drawn over the game (ui/fit.ts).

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useReducedMotion } from "../farm/hooks";
import { TextButton, kitVars } from "./menu/pieces";
import { UiContext, menuFit } from "./ui/fit";
import "./menu/menu.css";
import "./game-screen.css";

export function GameScreen({ children }: { children: ReactNode }) {
  // The UI's scale comes from the whole screen (the menu opens over all of it), never from the
  // view inside the border: the border's width follows the scale, so that would go round in circles.
  const screen = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const still = useReducedMotion();
  const navigate = useNavigate();
  const location = useLocation();

  useLayoutEffect(() => {
    const el = screen.current;
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
  const fit = menuFit(size?.w || window.innerWidth, size?.h || window.innerHeight);

  // Back where she came from in the app, or Home if the game was the first page opened.
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    const cameFromApp = typeof idx === "number" ? idx > 0 : location.key !== "default";
    if (cameFromApp) navigate(-1);
    else navigate("/");
  };

  return (
    <div ref={screen} className={`game-screen rio-ui${still ? " is-still" : ""}`} data-layout={fit.layout} data-u={fit.u}
      style={{ ...kitVars(), ["--u" as string]: `${fit.u}px` }}>
      <div className="game-view">
        <UiContext.Provider value={fit}>
          {children}
          <div className="rio-hud-top" style={{ fontSize: `${fit.u}px` }}>
            {/* PLACEHOLDER WORDING */}
            <TextButton label="Back" onClick={back} />
          </div>
        </UiContext.Provider>
      </div>
    </div>
  );
}

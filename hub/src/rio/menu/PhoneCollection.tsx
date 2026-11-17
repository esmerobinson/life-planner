// Esme's Rio on the phone: only the stickers she has collected (Esme, 2026-11-17: "no game on phone
// other than stickers collected UI"). The menu's Collection, in the kit's phone panel (its tabs
// and close button left out), full screen with the game screen's Back; no map, areas or menu.

import type { FarmView } from "../../farm/FarmContext";
import { useReducedMotion } from "../../farm/hooks";
import { UiContext, stageOf, useUi, type Box } from "../ui/fit";
import { CollectionTab } from "./CollectionTab";
import { em, kitVars, pos } from "./pieces";
import "./menu.css";

export function PhoneCollection({ view, canPlace }: { view: FarmView; canPlace: (key: string) => boolean }) {
  const outer = useUi();
  const fit = { ...outer, u: outer.menuU };
  const stage = stageOf(fit);
  const P = stage.panel;
  const inner: Box = { x: P.x + 6, y: P.y + 6, w: P.w - 13, h: P.h - 12 };
  const still = useReducedMotion();
  return (
    <UiContext.Provider value={fit}>
      <div className="rio-phone-collection">
        {/* PLACEHOLDER WORDING */}
        <section className={`rio-menu rio-ui${still ? " is-still" : ""}`} aria-label="Your sticker collection"
          style={{ ...kitVars(), fontSize: `${fit.u}px`, width: em(stage.w), height: em(stage.h) }}>
          <div className="pnl" style={{ ...pos(P.x, P.y, P.w, P.h), zIndex: 5 }} />
          <div className="a fill" style={{ ...pos(0, 0, stage.w, stage.h), zIndex: 6 }}>
            <CollectionTab view={view} panel={P} stage={stage} inner={inner} narrow canPlace={canPlace} />
          </div>
        </section>
      </div>
    </UiContext.Provider>
  );
}

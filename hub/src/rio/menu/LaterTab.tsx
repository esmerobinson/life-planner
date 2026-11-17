// Esme's Rio: a tab that comes in phase 2 (Wardrobe, Recipes). Laid out as the kit's place that
// hasn't opened (screens_a_book.js: the name centred at 30, the line at 52, the ribbon bow).

import { BitmapText } from "../ui/BitmapText";
import { INK } from "../ui/kit";
import type { TabProps } from "./GameMenu";
import { KitIcon, pos } from "./pieces";

export function LaterTab({ inner, name }: TabProps & { name: string }) {
  return (
    <div className="pnl-inner" style={pos(inner.x, inner.y, inner.w, inner.h)}>
      <BitmapText text={name} heading w={inner.w} align="center" style={{ position: "absolute", ...pos(0, 30) }} />
      {/* PLACEHOLDER WORDING */}
      <BitmapText text="Opens later" colour={INK.brown} w={inner.w - 20} align="center" style={{ position: "absolute", ...pos(10, 52) }} />
      <KitIcon name="ribbon-bow" x={Math.round(inner.w / 2) - 8} y={70} />
    </div>
  );
}

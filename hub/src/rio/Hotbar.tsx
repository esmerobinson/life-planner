// Esme's Rio: the menu button on the game screen, as the kit's hotbar (esme-ui src/core.js hotbar:
// a thin frame of slots, an icon in each, the red square on the one in use). Its slots are the
// kit's own, in the kit's order, less the calendar and letters (not built): Collection (the
// sticker book's icon), Wardrobe, Map, Noticeboard, Friends. Each opens the menu at that tab;
// Map closes it and goes back to the city.

import type { MenuTab } from "./menu/GameMenu";
import { KitIcon, em, pos } from "./menu/pieces";
import { useUi } from "./ui/fit";

// PLACEHOLDER WORDING (button names)
const SLOTS: { tab: MenuTab; icon: string; label: string }[] = [
  { tab: "collection", icon: "icon-book", label: "Collection" },
  { tab: "wardrobe", icon: "icon-wardrobe", label: "Wardrobe" },
  { tab: "map", icon: "icon-map", label: "Map" },
  { tab: "noticeboard", icon: "icon-noticeboard", label: "Noticeboard" },
  { tab: "friends", icon: "icon-friends", label: "Friends" },
];

/** The hotbar's size in UI px (slots across, the thin frame, 2 above the game's bottom edge). */
export const hotbarBox = (slots: number) => ({ w: slots * 16 + 6, h: 22, below: 2 });
/** Slots in an area (the same as on the map). */
export const AREA_HOTBAR_SLOTS = SLOTS.length;

export function Hotbar({ current, onPick }: { current: MenuTab | null; onPick: (t: MenuTab) => void }) {
  const { u } = useUi();
  const w = SLOTS.length * 16 + 6;
  const sel = SLOTS.findIndex((s) => s.tab === current);
  return (
    <div className="rio-hud-bottom">
      <nav className="rio-hotbar" aria-label="Game menu" style={{ fontSize: `${u}px`, width: em(w), height: em(22) }}>
        <div className="thin" style={pos(0, 0, w, 22)} />
        {SLOTS.map((s, i) => (
          <button key={s.tab} type="button" className="slot hb" aria-label={s.label} title={s.label}
            aria-current={i === sel ? "true" : undefined} style={pos(3 + i * 16, 3)} onClick={() => onPick(s.tab)}>
            <KitIcon name={s.icon} x={2} y={2} />
          </button>
        ))}
        {sel >= 0 && <div className="selq" aria-hidden="true" style={pos(3 + sel * 16, 3)} />}
      </nav>
    </div>
  );
}

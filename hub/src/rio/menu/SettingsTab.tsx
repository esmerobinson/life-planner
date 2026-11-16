// Esme's Rio: the Settings tab. The kit has no settings screen, so it is put together from kit
// pieces: Motion as three kit rows, the chosen one ticked (icon-tick in a thin frame); Help as the
// kit's welcome card lines (screens_b_mine.js helpWelcome: a slot with an icon, then the line).

import { useReducedMotion } from "../../farm/hooks";
import { motionPref, setMotionPref, type MotionPref } from "../../farm/motion";
import { BitmapText } from "../ui/BitmapText";
import { INK } from "../ui/kit";
import type { TabProps } from "./GameMenu";
import { KitIcon, RowButton, pos } from "./pieces";

// PLACEHOLDER WORDING (Settings and Help)
const MOTION: { pref: MotionPref; label: string }[] = [
  { pref: "system", label: "Follow this device" },
  { pref: "on", label: "Reduce motion" },
  { pref: "off", label: "Full motion" },
];

const HELP: [string, string][] = [
  ["icon-book", "Do things in your planner and you earn stickers."],
  ["icon-star", "Each sticker has a place in Rio. In Collection, tap one and place it."],
  ["icon-map", "New places open as the days go by. The Noticeboard says what's next."],
];

export function SettingsTab({ inner, narrow }: TabProps) {
  useReducedMotion(); // re-render when the choice changes
  const pref = motionPref();
  const colW = narrow ? inner.w - 8 : 96;
  const rowH = 17;
  const help = narrow ? { x: 4, y: 82, w: inner.w - 8, step: 34 } : { x: 110, y: 4, w: inner.w - 114, step: 30 };

  return (
    <div className="pnl-inner" style={pos(inner.x, inner.y, inner.w, inner.h)}>
      <BitmapText text="Motion" heading style={{ position: "absolute", ...pos(6, 4) }} />
      <div role="radiogroup" aria-label="Motion">
        {MOTION.map((m, i) => (
          <RowButton key={m.pref} role="radio" aria-checked={pref === m.pref} x={4} y={20 + i * (rowH + 2)} w={colW} h={rowH}
            onClick={() => setMotionPref(m.pref)}>
            <i className="thin" aria-hidden="true" style={pos(4, 3, 11, 11)} />
            {pref === m.pref && <KitIcon name="icon-tick" x={6} y={5} />}
            <BitmapText text={m.label} style={{ position: "absolute", ...pos(19, 5) }} />
          </RowButton>
        ))}
      </div>

      <BitmapText text="How it works" heading w={help.w} align="center" style={{ position: "absolute", ...pos(help.x, help.y) }} />
      {HELP.map(([icon, line], i) => {
        const y = help.y + 16 + i * help.step;
        return (
          <div key={icon} className="a" style={pos(help.x, y, help.w, help.step)}>
            <i className="slot" aria-hidden="true" style={pos(0, 0)}><KitIcon name={icon} x={2} y={2} /></i>
            <BitmapText text={line} w={help.w - 22} style={{ position: "absolute", ...pos(22, 1) }} />
          </div>
        );
      })}
      {!narrow && (
        <BitmapText text="Esc opens and closes this menu." colour={INK.brown} w={help.w}
          style={{ position: "absolute", ...pos(help.x, help.y + 16 + HELP.length * help.step) }} />
      )}
    </div>
  );
}

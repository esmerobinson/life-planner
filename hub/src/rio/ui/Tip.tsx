// Esme's Rio: a small hover label over the game, in the kit's tooltip piece (esme-ui tipHTML: the
// tooltip nine-slice, the small pixel font). Esme, 2026-11-17: "Keep it small though and
// subtle". It stands beside what it names (above, below, right or left of `at`, in CSS px of the
// box it's placed in), never over it, and never takes the pointer.

import { BitmapText } from "./BitmapText";
import { useUi } from "./fit";
import { INK } from "./kit";

export type TipSide = "above" | "below" | "right" | "left";

const SHIFT: Record<TipSide, string> = {
  above: "translate(-50%, -100%)",
  below: "translate(-50%, 0)",
  right: "translate(0, -50%)",
  left: "translate(-100%, -50%)",
};

export function Tip({ lines, at, side, className }: {
  /** The first line is the name (dark), the rest say more (the kit's body ink). */
  lines: readonly string[];
  at: { x: number; y: number };
  side: TipSide;
  className?: string;
}) {
  const { u } = useUi();
  return (
    <div className={`tip rio-tip${className ? ` ${className}` : ""}`} role="tooltip" data-side={side}
      style={{ left: at.x, top: at.y, transform: SHIFT[side], fontSize: `${u}px` }}>
      {lines.map((l, i) => <BitmapText key={i} text={l} colour={i === 0 ? INK.dark : INK.ink} w={i === 0 ? undefined : 110} />)}
    </div>
  );
}

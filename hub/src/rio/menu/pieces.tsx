// Esme's Rio: the kit's pieces as React parts, drawn as the kit's own mockups draw them (esme-ui
// src/core.js and page.css): every size in UI pixels (1em = one UI pixel), the piece images as
// --k-<name> custom properties, nine-slice pieces as border-images (menu.css).

import type { CSSProperties, ReactNode } from "react";
import { asset } from "../../farm/catalogue";
import { sheetUrl } from "../../farm/sprites";
import { BitmapText } from "../ui/BitmapText";
import { INK, KIT, kitUrl } from "../ui/kit";

export const em = (n: number) => `${n}em`;

/** left/top (and width/height) in UI pixels. */
export const pos = (x: number, y: number, w?: number, h?: number): CSSProperties => ({
  left: em(x), top: em(y), ...(w !== undefined ? { width: em(w) } : {}), ...(h !== undefined ? { height: em(h) } : {}),
});

/** Every kit piece as a --k-<name> custom property, plus the sticker sheets (set once on the root). */
export function kitVars(): CSSProperties {
  const vars: Record<string, string> = {};
  for (const name of Object.keys(KIT)) {
    const u = kitUrl(name);
    if (u) vars[`--k-${name}`] = `url("${u}")`;
  }
  vars["--k-stickers"] = `url("${sheetUrl("stickers")}")`;
  vars["--k-ghosts"] = `url("${sheetUrl("stickers-ghost")}")`;
  vars["--stk-sheet-w"] = em(asset("stickers").frames * 16);
  return vars as CSSProperties;
}

/** A kit picture (core.js K): its own size at 1x, or a magenta placeholder where the kit has none. */
export function KitIcon({ name, x, y, w, h, className }: { name: string | null; x: number; y: number; w?: number; h?: number; className?: string }) {
  const piece = name ? KIT[name] : undefined;
  if (!name || !piece) {
    // PLACEHOLDER: the kit has no picture for this yet (obviously wrong on purpose).
    return <i className={`k k-placeholder ${className ?? ""}`} aria-hidden="true" style={pos(x, y, w ?? 12, h ?? 12)} />;
  }
  return (
    <i className={`k ${className ?? ""}`} aria-hidden="true"
      style={{ ...pos(x, y, w ?? piece.w, h ?? piece.h), backgroundImage: `var(--k-${name})` }} />
  );
}

/** A 16x16 sticker from the app's sticker sheets (its silhouette for one not yet earned). */
export function StickerArt({ index, ghost = false, x = 0, y = 0 }: { index: number; ghost?: boolean; x?: number; y?: number }) {
  return (
    <i className={ghost ? "stk ghost" : "stk"} aria-hidden="true"
      style={{ ...pos(x, y), backgroundPosition: `${em(-index * 16)} 0` }} />
  );
}

/** The orange word button (core.js tbtn): cream text with the button shadow. */
export function TextButton({ label, x, y, w, h = 14, onClick, className, children, ...rest }: {
  label: string; x?: number; y?: number; w?: number; h?: number; onClick: () => void; className?: string; children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const style: CSSProperties = x === undefined ? { height: em(h), ...(w ? { width: em(w) } : {}) } : { ...pos(x, y ?? 0, w, h) };
  return (
    <button type="button" className={`tbtn ${x === undefined ? "flow" : ""} ${className ?? ""}`} style={style} onClick={onClick} {...rest}>
      <BitmapText text={label} colour={INK.cream} shadow={INK.buttonShadow} />
      {children}
    </button>
  );
}

/** A kit cycle arrow (core.js arrowBtn). */
export function ArrowButton({ dir, label, x, y, onClick, disabled }: {
  dir: "left" | "right"; label: string; x: number; y: number; onClick: () => void; disabled?: boolean;
}) {
  const piece = KIT[`btn-arrow-${dir}`]!;
  return (
    <button type="button" className="btn arr" aria-label={label} disabled={disabled} onClick={onClick}
      style={{ ...pos(x, y, piece.w, piece.h), backgroundImage: `var(--k-btn-arrow-${dir})` }} />
  );
}

/** A clickable list row (kit `row`, `row-hover`), its content placed from the row's top-left. */
export function RowButton({ x, y, w, h, children, className, ...rest }: {
  x: number; y: number; w: number; h: number; children: ReactNode; className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`rowbtn ${className ?? ""}`} style={pos(x, y, w, h)} {...rest}>
      <i className="kit-row" aria-hidden="true" />
      {children}
    </button>
  );
}

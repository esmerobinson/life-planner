// Esme's Rio: text in the kit's body pixel font (esme-ui src/core.js drawText). The words are kept
// as real text for screen readers (visually hidden); the canvas that shows them is hidden from
// them. Body text draws at bodyPx(u) CSS px per font pixel, headings at headPx(u).

import { useEffect, useRef, type CSSProperties } from "react";
import { canDraw } from "../../farm/sprites";
import { FONT, FONT_URL, glyphOf, measure, wrapText } from "./font";
import { bodyPx, headPx, useUi } from "./fit";
import { INK } from "./kit";

let fontImg: Promise<HTMLImageElement> | null = null;
function loadFont(): Promise<HTMLImageElement> {
  fontImg ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No pixel font"));
    img.src = FONT_URL;
  });
  return fontImg;
}

const tints = new Map<string, HTMLCanvasElement>();
function tinted(img: HTMLImageElement, colour: string): HTMLCanvasElement {
  let c = tints.get(colour);
  if (!c) {
    c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = colour;
    x.fillRect(0, 0, c.width, c.height);
    tints.set(colour, c);
  }
  return c;
}

export interface BitmapTextProps {
  text: string;
  /** Heading size (the kit's "d"): the same font, drawn at the UI scale. */
  heading?: boolean;
  colour?: string;
  /** A 1-pixel shadow down-right (the word button's, for example). */
  shadow?: string;
  /** Wrap width in UI px. */
  w?: number;
  align?: "left" | "center" | "right";
  /** Line height in font px (the font's own, 11, if not given). */
  lh?: number;
  className?: string;
  style?: CSSProperties;
}

export function BitmapText({ text, heading = false, colour = INK.ink, shadow, w, align, lh, className, style }: BitmapTextProps) {
  const { u } = useUi();
  const fz = heading ? headPx(u) : bodyPx(u);
  const canvas = useRef<HTMLCanvasElement>(null);
  const maxW = w ? Math.floor((w * u) / fz) : Infinity;
  const lines = Number.isFinite(maxW) ? wrapText(text, maxW) : text.split("\n");
  const widths = lines.map(measure);
  const sh = shadow ? 1 : 0;
  const lineH = lh ?? FONT.lineHeight;
  const cw = Math.max(1, (Number.isFinite(maxW) && align ? maxW : Math.max(1, ...widths)) + sh);
  const ch = lines.length * lineH - (lineH - FONT.lineHeight) + sh;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !canDraw()) return;
    let live = true;
    void loadFont().then((img) => {
      if (!live) return;
      const x = cv.getContext("2d");
      if (!x) return;
      x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, cw, ch);
      const passes: [HTMLCanvasElement, number][] = shadow ? [[tinted(img, shadow), 1], [tinted(img, colour), 0]] : [[tinted(img, colour), 0]];
      for (const [src, d] of passes) {
        lines.forEach((line, i) => {
          let cx = align === "center" ? Math.round((cw - sh - widths[i]!) / 2) : align === "right" ? cw - sh - widths[i]! : 0;
          const cy = i * lineH;
          for (const c of line) {
            const g = glyphOf(c);
            if (g.w) x.drawImage(src, g.x, g.y, g.w, g.h, cx + d, cy + d, g.w, g.h);
            cx += g.advance;
          }
        });
      }
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [text, colour, shadow, cw, ch, lineH, align, lines.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={className ? `bt ${className}` : "bt"} style={style}>
      <span className="visually-hidden">{text}</span>
      <canvas ref={canvas} width={cw} height={ch} aria-hidden="true" className="farm-px" style={{ width: cw * fz, height: ch * fz }} />
    </span>
  );
}

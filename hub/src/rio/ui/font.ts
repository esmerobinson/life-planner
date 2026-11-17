// Esme's Rio: the kit's body pixel font ("small" in esme-ui font/fonts.json), the one font of the
// game's UI (Esme, 2026-11-09: no display or storybook fonts). Measuring and wrapping work in font
// pixels; esme-ui src/core.js is the reference (measure, wrap, GLMAP).

import rawFonts from "../../assets/rio-ui/font/fonts.json";
import fontUrl from "../../assets/rio-ui/font/font-small.png?url";

export interface Glyph { x: number; y: number; w: number; h: number; advance: number }

export const FONT = (rawFonts as unknown as {
  small: { lineHeight: number; letterSpacing: number; glyphs: Record<string, Glyph> };
}).small;

export const FONT_URL: string = fontUrl;

/** Characters the font draws as another (core.js GLMAP). */
const GLMAP: Record<string, string> = { "·": "•", "›": ">", "‹": "<", "✓": "•", "’": "'", "♡": "♥" };

/** The glyph for a character: its own, the kit's stand-in, the letter without its accent, or "?". */
export function glyphOf(ch: string): Glyph {
  const g = FONT.glyphs;
  return g[ch] ?? g[GLMAP[ch] ?? ""] ?? g[ch.normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? g["?"]!;
}

/** Width in font pixels (the advances, less the spacing after the last letter). */
export function measure(text: string): number {
  if (!text) return 0;
  let w = 0;
  for (const ch of text) w += glyphOf(ch).advance;
  return w - FONT.letterSpacing;
}

/** Lines of `text` no wider than `maxW` font pixels, broken at spaces (and at "\n"). */
export function wrapText(text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const t = line ? `${line} ${word}` : word;
      if (measure(t) > maxW && line) {
        out.push(line);
        line = word;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

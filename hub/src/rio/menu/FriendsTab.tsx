// Esme's Rio: the Friends tab. Who lives here, and what each one wears (the outfits she picks; the
// old page's character panel, moved here so nothing sits below the game screen). The kit has no
// friends list screen (its wardrobe screen is phase 2's), so this is put together from kit rows:
// the friends down the left, the chosen friend's picture, name and wardrobe on the right, its
// pages turned with the kit's arrows.

import { useState } from "react";
import { CharacterPic } from "../../farm/CharacterPic";
import { CHARACTERS, type CharacterId } from "../../farm/state";
import { ACCESSORIES, NAMES } from "../../farm/world";
import { BitmapText } from "../ui/BitmapText";
import { INK } from "../ui/kit";
import type { TabProps } from "./GameMenu";
import { ArrowButton, RowButton, em, pos } from "./pieces";

export function FriendsTab({ view, inner, narrow }: TabProps) {
  const here = CHARACTERS.filter((c) => view.arrived.has(c));
  const [who, setWho] = useState<CharacterId>(here[0] ?? "domino");
  const [pg, setPg] = useState(0);
  const current = view.state.outfits.get(who) ?? null;
  const items = ACCESSORIES.filter((a) => view.unlocked.includes(a.code));
  // PLACEHOLDER WORDING ("Nothing")
  const choices = [{ code: null as string | null, name: "Nothing" }, ...items.map((a) => ({ code: a.code as string | null, name: a.name }))];
  const wearing = current !== null && items.some((a) => a.code === current) ? current : null;

  const left = narrow ? { x: 2, w: 62 } : { x: 4, w: 76 };
  const right = narrow ? { x: 68, w: inner.w - 70 } : { x: 86, w: inner.w - 90 };
  const per = narrow ? 7 : 6;
  const pages = Math.max(1, Math.ceil(choices.length / per));
  const page = Math.min(pg, pages - 1);
  const shown = choices.slice(page * per, page * per + per);
  const arrowsY = 50 + per * 15 + 2;

  return (
    <div className="pnl-inner" style={pos(inner.x, inner.y, inner.w, inner.h)}>
      <div role="group" aria-label="Who lives here">
        {here.map((c, i) => (
          <RowButton key={c} x={left.x} y={4 + i * 20} w={left.w} h={18} aria-pressed={who === c}
            onClick={() => { setWho(c); setPg(0); }}>
            <BitmapText text={NAMES[c]} w={left.w - 10} style={{ position: "absolute", ...pos(5, 5) }} />
          </RowButton>
        ))}
      </div>

      <section aria-label={NAMES[who]}>
        <div className="a" style={pos(right.x + Math.floor((right.w - 32) / 2), 2, 32, 32)}>
          <CharacterPic view={view} c={who} size={em(32)} />
        </div>
        <BitmapText text={NAMES[who]} heading w={right.w} align="center" style={{ position: "absolute", ...pos(right.x, 36) }} />
        <div role="group" aria-label="Wardrobe">
          {shown.map((a, j) => (
            <RowButton key={a.code ?? "none"} x={right.x} y={50 + j * 15} w={right.w} h={14} aria-pressed={wearing === a.code}
              onClick={() => void view.setOutfit(who, a.code)}>
              <BitmapText text={a.name} w={right.w - 10} style={{ position: "absolute", ...pos(5, 3) }} />
            </RowButton>
          ))}
        </div>
        {pages > 1 && (
          <>
            <ArrowButton dir="left" label="Previous things to wear" x={right.x} y={arrowsY} onClick={() => setPg((p) => (p - 1 + pages) % pages)} />
            <ArrowButton dir="right" label="More things to wear" x={right.x + right.w - 11} y={arrowsY} onClick={() => setPg((p) => (p + 1) % pages)} />
          </>
        )}
      </section>
      {/* PLACEHOLDER WORDING */}
      {items.length < ACCESSORIES.length && (
        <BitmapText text="More things to wear come with more stickers." colour={INK.brown} w={narrow ? inner.w - 4 : right.w}
          style={{ position: "absolute", ...pos(narrow ? 2 : right.x, narrow ? inner.h - 22 : inner.h - 9) }} />
      )}
    </div>
  );
}

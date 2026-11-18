// Esme's Rio: an earned sticker's moment on the game screen. Esme, 2026-11-17: "The dog in the
// corner bottom left, that box is super ugly and covers things and ruins the aesthetic … Bottom
// left UI box seems to be redundant." The nook stays on every other page; on the game screen the
// moment is a small kit pop-up, top centre like "<name> has moved in!": the stickers just earned
// (kept for good as soon as they show), until she says OK. Never while she types.

import { useEffect, useState } from "react";
import { STICKER_BY_KEY } from "../farm/catalogue";
import { useTyping } from "../farm/hooks";
import { StickerArt, TextButton, em } from "./menu/pieces";
import { BitmapText } from "./ui/BitmapText";

export function GameMoments({ queue, markSeen }: { queue: readonly string[]; markSeen: (sticker: string) => Promise<void> }) {
  const [shown, setShown] = useState<string[]>([]);
  const typing = useTyping();
  const next = queue.filter((k) => STICKER_BY_KEY.has(k));

  useEffect(() => {
    if (shown.length > 0 || next.length === 0 || typing) return;
    setShown(next);
    // A failed write leaves it unseen: it shows again later.
    for (const k of next) void markSeen(k).catch(() => undefined);
  }, [shown.length, next.join(), typing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shown.length === 0) return null;
  return (
    <div className="thin flow rio-moment" role="status">
      {shown.map((k) => (
        <p key={k}>
          <span style={{ position: "relative", width: em(16), height: em(16) }}><StickerArt index={STICKER_BY_KEY.get(k)!.index} /></span>
          {/* PLACEHOLDER WORDING */}
          <BitmapText text={`New sticker: ${STICKER_BY_KEY.get(k)!.name}`} />
        </p>
      ))}
      <TextButton label="OK" w={24} onClick={() => setShown([])} />
    </div>
  );
}

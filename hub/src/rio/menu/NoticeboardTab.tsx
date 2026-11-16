// Esme's Rio: the Noticeboard tab. Laid out as the kit's noticeboard list (esme-ui
// src/screens_c_more.js boardHTML, phone): a kit row per note with its icon and a heading line,
// a footer line, and a tap opens the note (noteDetailHTML: its icon centred, heading, body, a back
// arrow). The kit's desktop board (300x210, four pinned papers) is larger than the menu's panel,
// so the desktop uses the same list. Only what is true today: the next place to open, what she
// earned lately, the next friend; bundles, the stuck task and themed nights come in phase 2 and
// their note says so plainly (nothing made up).

import { useState } from "react";
import { STICKER_BY_KEY } from "../../farm/catalogue";
import { CharacterPic } from "../../farm/CharacterPic";
import { stickerTotals } from "../../farm/world";
import { weekdayOf } from "../../domain/dates";
import type { AreaStatus } from "../areas";
import { nextFriend, nextOpening, recentStickers } from "../notices";
import { BitmapText } from "../ui/BitmapText";
import { INK, KIT } from "../ui/kit";
import type { TabProps } from "./GameMenu";
import { ArrowButton, KitIcon, RowButton, StickerArt, em, pos } from "./pieces";

type NoteKey = "opens" | "earned" | "friend" | "later";

interface Note { key: NoteKey; icon: string; row: string; title: string; body: string }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const longDate = (d: string) => `${DAYS[weekdayOf(d)] ?? ""} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`.trim();
const inDays = (n: number) => (n <= 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

export function NoticeboardTab({ view, stage, inner, narrow, day, statuses }: TabProps & {
  day: number; statuses: ReadonlyMap<string, AreaStatus>;
}) {
  const [open, setOpen] = useState<NoteKey | null>(null);
  const opening = nextOpening(statuses, view.state.start, view.today);
  const recent = recentStickers(view.state.seenOn);
  const friend = nextFriend(stickerTotals(view.earnedSet).friends, day, view.arrived);

  // PLACEHOLDER WORDING (every note)
  const notes: Note[] = [
    opening
      ? { key: "opens", icon: "icon-map", row: `Opens next: ${opening.name}`, title: opening.name,
          body: `Opens on day ${opening.day}, ${longDate(opening.date)}. ${inDays(opening.inDays)}.` }
      : { key: "opens", icon: "icon-map", row: "All of Rio is open", title: "All of Rio is open", body: "Every place drawn so far is open." },
    { key: "earned", icon: "badge-new", row: "Just earned", title: "Just earned",
      body: recent.length ? recent.map((k) => STICKER_BY_KEY.get(k)!.name).join(", ") : "Nothing yet. Tick something off in your planner." },
    friend
      ? { key: "friend", icon: "icon-friends", row: `Next friend: ${friend.name}`, title: `${friend.name} moves in next`,
          body: `At ${friend.at} stickers or on day ${friend.at}, whichever comes first.` +
            (friend.stickersToGo > 0 ? ` ${friend.stickersToGo} more stickers, or ${friend.daysToGo} more days.` : "") }
      : { key: "friend", icon: "icon-friends", row: "Everyone has moved in", title: "Everyone has moved in", body: "All your friends live in Rio now." },
    { key: "later", icon: "icon-noticeboard", row: "Bundles and more: later", title: "Coming later",
      body: "Bundles, the stuck task and themed nights will be pinned here in a later update." },
  ];

  const note = notes.find((n) => n.key === open);
  if (note) {
    const ic = KIT[note.icon]!;
    return (
      <div className="a fill" style={pos(0, 0, stage.w, stage.h)}>
        <ArrowButton dir="left" label="Back" x={narrow ? inner.x + 4 : inner.x - 20} y={narrow ? inner.y + 4 : inner.y - 2} onClick={() => setOpen(null)} />
        <div className="pnl-inner note-detail" style={pos(inner.x, inner.y, inner.w, inner.h)}>
          {note.key === "friend" && friend
            ? <CharacterPic view={view} c={friend.id} size={em(32)} className="note-pic" />
            : <i className="k note-icon" aria-hidden="true" style={{ width: em(ic.w), height: em(ic.h), backgroundImage: `var(--k-${note.icon})` }} />}
          <BitmapText text={note.title} heading w={inner.w} align="center" />
          {note.key === "earned" && recent.length > 0 && (
            <div className="note-slots" aria-hidden="true" style={{ width: em(recent.length * 16) }}>
              {recent.map((k, i) => (
                <i key={k} className="slot" style={pos(i * 16, 0)}><StickerArt index={STICKER_BY_KEY.get(k)!.index} /></i>
              ))}
            </div>
          )}
          <BitmapText text={note.body} heading={!narrow} lh={12} w={inner.w - 20} className="note-body" />
        </div>
      </div>
    );
  }

  const rowH = 29;
  return (
    <div className="pnl-inner" style={pos(inner.x, inner.y, inner.w, inner.h)}>
      {notes.map((n, i) => {
        const ic = KIT[n.icon]!;
        return (
          <RowButton key={n.key} x={0} y={2 + i * 31} w={inner.w} h={rowH} onClick={() => setOpen(n.key)}>
            <KitIcon name={n.icon} x={6 + Math.floor((16 - Math.min(16, ic.w)) / 2)} y={ic.h > 10 ? 8 : 10} />
            <BitmapText text={n.row} heading w={inner.w - 35} style={{ position: "absolute", ...pos(28, 9) }} />
          </RowButton>
        );
      })}
      {/* PLACEHOLDER WORDING */}
      <BitmapText text="Notes from Rio. Tap one to read it." colour={INK.brown} w={inner.w - 4}
        style={{ position: "absolute", ...pos(2, inner.h - 16) }} />
    </div>
  );
}

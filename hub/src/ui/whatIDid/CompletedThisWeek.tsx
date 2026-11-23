import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { db } from "../../data/db";
import { dayLabel } from "../../domain/display";
import type { ISODate, Item } from "../../domain/types";
import { completedInWeek } from "../../domain/whatIDid";
import { areaName } from "./DidBox";
import { DID_WORDS as W } from "./words";

/**
 * "Completed this week" in the weekly review (Esme, 19 Nov 2026): the to-dos ticked done that week
 * (Monday to Sunday; `week`, any day in it, else today's) and project sessions, each with what she
 * wrote, read-only. DISPLAY ONLY: it is not part of the review's answers, so it never goes to
 * Together (only "Weekly review done" ever goes, together/journalNotes.ts) or anywhere else. Strips
 * (strips.css), no tick box; the place in the review is provisional (for Design).
 */
export function CompletedThisWeek({ today, week }: { today: ISODate; week?: ISODate }) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.items.where("status").anyOf("open", "done").toArray()).subscribe({
      next: setItems,
      error: () => setItems([]),
    });
    return () => sub.unsubscribe();
  }, []);
  if (!items) return null;
  const rows = completedInWeek(items, week ?? today, areaName);
  return (
    <section className="did-week" aria-label={W.completedHeading}>
      <p className="journal-q">{W.completedHeading}</p>
      <p className="journal-muted">{W.completedLine}</p>
      {rows.length === 0 ? (
        <p className="journal-muted">{W.completedEmpty}</p>
      ) : (
        <ul className="strip-list" aria-label={W.completedHeading}>
          {rows.map((r) => (
            <li key={r.key} className="strip no-tick did-entry">
              <div className="strip-body">
                <div className="strip-title">{r.project ? `${r.project}: ${r.todo}` : r.todo}</div>
                <div className="strip-meta">{`${dayLabel(r.on, today)} · ${r.areaLabel}`}</div>
                {r.note && <p className="did-note">{r.note}</p>}
                {r.files.length > 0 && <div className="strip-meta">{r.files.map((f) => f.name).join(", ")}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

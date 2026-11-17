import { useContext, useRef, useState } from "react";
import { updateItem } from "../data/repo";
import { addDays, mondayOf, weekdayOf } from "../domain/dates";
import { HABIT_WORDS, doneToday, isRepeating } from "../domain/habits";
import type { AreaId, ISODate, Item, Weekday } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS_MIND_FIRST, INBOX_TILE, NAV } from "./areas";
import { DOTS_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { ShellContext } from "./shellContext";
import { StripTitle } from "./TaskRow";
import { useHubData } from "./useHubData";
import { useRepeatActions } from "./useRepeatActions";

/** Monday first, as the day buttons and the week columns read. */
export const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LETTER: Record<Weekday, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const NAME: Record<Weekday, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};
const SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** What she is told when she taps the only day left on (a repeat needs at least one day). */
export const LAST_DAY = "It has to repeat on at least one day. To stop it repeating, use Stop repeating in the … menu.";

/** Every repeating item by area: Mind first, then the sidebar's order, and the Inbox (older imports) last. */
export function repeatGroups(items: Item[]): { areaId: AreaId; label: string; items: Item[] }[] {
  const order = [...GOAL_AREAS_MIND_FIRST, ...AREA_CHOICES.filter((a) => a.id === "inbox")];
  const repeating = items.filter(isRepeating);
  return order
    .map((a) => ({
      areaId: a.id,
      label: a.label,
      items: repeating.filter((i) => i.areaId === a.id).sort((x, y) => x.title.localeCompare(y.title)),
    }))
    .filter((g) => g.items.length > 0);
}

/** `days` with `day` switched (Monday-first order), or null when that would leave no day on. */
export function toggledDays(days: Weekday[] | undefined, day: Weekday): Weekday[] | null {
  const on = new Set(days ?? []);
  if (on.has(day)) on.delete(day);
  else on.add(day);
  const next = WEEK.filter((d) => on.has(d));
  return next.length ? next : null;
}

/** Monday to Sunday of today's week, each with the repeats that fall on it (in `repeatGroups` order). */
export function weekColumns(items: Item[], today: ISODate): { date: ISODate; day: Weekday; items: Item[] }[] {
  const all = repeatGroups(items).flatMap((g) => g.items);
  const monday = mondayOf(today);
  return WEEK.map((_, i) => {
    const date = addDays(monday, i);
    const day = weekdayOf(date);
    return { date, day, items: all.filter((it) => it.recur?.includes(day)) };
  });
}

/** An area's tile (colour and icon) for the week view's small strips; the Inbox has its own. */
function tileOf(areaId: AreaId) {
  return areaId === "inbox" ? INBOX_TILE : (NAV.find((n) => n.id === areaId) ?? INBOX_TILE);
}

/**
 * The Repeating page: everything that repeats, across all areas. Each row has its seven day
 * buttons (a tap saves), and a "…" menu with Stop repeating (kept as a one-off to-do) and
 * Delete (to the Bin). "This week" shows Monday to Sunday as columns (Esme's picks 1·2 A and
 * 1·3 A, app design queue, 2026-11-17).
 */
export function RepeatingPage({ today }: { today: ISODate }) {
  const { items, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  const after = async () => {
    await refresh();
    await shell?.refresh();
  };
  const actions = useRepeatActions(today, after);
  const groups = repeatGroups(items);
  const [view, setView] = useState<"area" | "week">("area");

  return (
    <section className="repeating-page page-sheet">
      <h1>Repeating</h1>
      {error && <p>{error}</p>}
      <p>
        Everything that repeats. Tap a day to switch it on or off; it saves straight away. Stop repeating (it stays as a
        one-off to-do) and Delete (to the Bin) are in each row's … menu.
      </p>
      {actions.saveError && <p className="form-message">{actions.saveError}</p>}
      {loaded && !error && groups.length === 0 && <p>Nothing repeats.</p>}
      {groups.length > 0 && (
        <div className="btn-group repeat-views" role="group" aria-label="Show">
          <button type="button" aria-pressed={view === "area"} onClick={() => setView("area")}>
            By area
          </button>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
            This week
          </button>
        </div>
      )}
      {view === "area" ? (
        groups.map((g) => (
          <section key={g.areaId}>
            <h2>{g.label}</h2>
            <ul aria-label={`Repeating in ${g.label}`} className="strip-list">
              {g.items.map((it) => (
                <RepeatRow key={it.id} item={it} today={today} actions={actions} onSaved={after} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <WeekView items={items} today={today} />
      )}
    </section>
  );
}

/** One repeat: its title, the seven day buttons, and the "…" menu. */
function RepeatRow({
  item,
  today,
  actions,
  onSaved,
}: {
  item: Item;
  today: ISODate;
  actions: ReturnType<typeof useRepeatActions>;
  onSaved: () => Promise<void>;
}) {
  const { attempt, saveError } = useSaveError();
  // The days as last tapped, shown at once and kept until the saved row comes back, so quick
  // taps each build on the one before (never on a row read before the last save landed).
  const [pending, setPending] = useState<Weekday[] | null>(null);
  const latest = useRef<Weekday[] | null>(null);
  const [lastDay, setLastDay] = useState(false);
  const days = pending ?? item.recur ?? [];

  async function toggle(day: Weekday) {
    const next = toggledDays(latest.current ?? item.recur, day);
    if (!next) {
      setLastDay(true);
      return;
    }
    setLastDay(false);
    latest.current = next;
    setPending(next);
    const ok = await attempt(() => updateItem(item.id, { recur: next }, today));
    if (latest.current !== next) return; // a later tap is on its way; it settles the row
    if (ok) await onSaved();
    latest.current = null;
    setPending(null);
  }

  return (
    <li className="strip no-tick repeat-row">
      <div className="strip-body">
        <StripTitle item={item} />
        <div className="day-buttons" role="group" aria-label={`Repeats on: ${item.title}`}>
          {WEEK.map((d) => (
            <button
              key={d}
              type="button"
              className="day-button"
              aria-pressed={days.includes(d)}
              aria-label={NAME[d]}
              title={NAME[d]}
              onClick={() => void toggle(d)}
            >
              {LETTER[d]}
            </button>
          ))}
        </div>
        <span className="visually-hidden">{HABIT_WORDS.schedule(days)}</span>
        {lastDay && <p className="form-message">{LAST_DAY}</p>}
        {saveError && <p className="form-message">{saveError}</p>}
      </div>
      <div className="strip-actions">
        <IconPopover icon={DOTS_GLYPH} label={`More: ${item.title}`} tooltip="More" groupLabel={`More for ${item.title}`}>
          {(close) => (
            <>
              <button
                type="button"
                aria-label={`Stop repeating: ${item.title}`}
                onClick={() => {
                  close();
                  void actions.stop(item);
                }}
              >
                Stop repeating
              </button>
              <button
                type="button"
                aria-label={`Delete: ${item.title}`}
                onClick={() => {
                  close();
                  void actions.remove(item);
                }}
              >
                Delete
              </button>
            </>
          )}
        </IconPopover>
      </div>
    </li>
  );
}

/** "This week": Monday to Sunday side by side (stacked on a phone), today outlined. */
function WeekView({ items, today }: { items: Item[]; today: ISODate }) {
  const panel = usePanel();
  return (
    <div className="week-cols">
      {weekColumns(items, today).map((c) => {
        const isToday = c.date === today;
        return (
          <section key={c.date} className={isToday ? "week-day is-today" : "week-day"} aria-label={`${NAME[c.day]}${isToday ? ", today" : ""}`}>
            <h2>
              {SHORT[c.day]} <small>{`${Number(c.date.slice(8))}${isToday ? " · today" : ""}`}</small>
            </h2>
            <ul className="week-list">
              {c.items.map((it) => {
                const tile = tileOf(it.areaId);
                const crossed = isToday && doneToday(it, today);
                const title = <span className="week-title">{it.title}</span>;
                return (
                  <li key={it.id} className={crossed ? "week-mini crossed" : "week-mini"}>
                    <span className="week-tile" style={{ background: tile.tile }}>
                      <img src={tile.icon} alt="" />
                    </span>
                    {panel ? (
                      <button type="button" className="week-open" onClick={() => panel.open(it.id)}>
                        {crossed && <span className="visually-hidden">Done today: </span>}
                        {title}
                      </button>
                    ) : (
                      title
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

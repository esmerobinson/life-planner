import { useRef, useState } from "react";
import { addSession, removeSession, setSessionDone, updateSession } from "../data/repo";
import { daysBetween, addDays } from "../domain/dates";
import { dayLabel, nextMonday } from "../domain/display";
import { countdown, doneCount, MAX_SESSION_DETAILS, MAX_SESSION_TITLE, MAX_SESSIONS } from "../domain/projects";
import type { ISODate, Item, Session } from "../domain/types";
import { CALENDAR_GLYPH, IconPopover } from "./IconPopover";
import { useGrow } from "./ItemPanel";
import { ProgressBar } from "./ProgressBar";
import { SessionBoxes, sessionBoxLabel } from "./ProjectBits";
import { DayPart } from "./ScheduleMenu";
import { useDraft } from "./useDraft";

/** Details longer than this are cut short in the list with "See more" (a reading length, not a look). */
export const DETAILS_SHORT = 140;

type Write = (fn: () => Promise<unknown>) => Promise<void>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The project's summary box (2C panel): the session boxes with "2 of 4 sessions", then the
 * deadline over a bar that empties towards it.
 */
export function ProjectSummary({ item, today, onChanged }: { item: Item; today: ISODate; onChanged: () => Promise<void> }) {
  const total = item.sessions?.length ?? 0;
  const left = countdown(item, today);
  const days = item.due === undefined ? 0 : daysBetween(today, item.due);
  return (
    <div className="goal-peek-box project-summary">
      <div className="project-summary-row">
        <SessionBoxes item={item} today={today} onChanged={onChanged} />
        <b>{`${doneCount(item)} of ${plural(total, "session")}`}</b>
      </div>
      {item.due !== undefined && left !== null && (
        <div>
          <div className="bar-label project-summary-due">
            <span>{`Due ${dayLabel(item.due, today)}`}</span>
            <b className={days < 0 ? "strip-late" : undefined}>
              {days > 0 ? `${plural(days, "day")} left` : days === 0 ? "Due today" : `${plural(-days, "day")} late`}
            </b>
          </div>
          <ProgressBar ratio={left} label="Time left until the deadline" />
        </div>
      )}
    </div>
  );
}

/** The "Sessions" section: one strip per session and "+ Add a session". */
export function SessionList({ item, today, write }: { item: Item; today: ISODate; write: Write }) {
  const list = item.sessions ?? [];
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <div>
      <div className="peek-sec">
        Sessions
        {list.length < MAX_SESSIONS && (
          <button
            type="button"
            className="peek-add"
            onClick={() =>
              void write(async () => {
                setFocusId(await addSession(item.id, today));
              }).catch(() => {})
            }
          >
            + Add a session
          </button>
        )}
      </div>
      <ul aria-label="Sessions" className="strip-list">
        {list.map((s, i) => (
          <SessionRow
            key={s.id}
            item={item}
            session={s}
            index={i}
            count={list.length}
            today={today}
            write={write}
            autoFocus={s.id === focusId}
          />
        ))}
      </ul>
    </div>
  );
}

function SessionRow({
  item, session: s, index, count, today, write, autoFocus,
}: { item: Item; session: Session; index: number; count: number; today: ISODate; write: Write; autoFocus: boolean }) {
  const n = index + 1;
  const done = s.doneOn !== undefined;
  const save = (patch: Parameters<typeof updateSession>[2]) => write(() => updateSession(item.id, s.id, patch, today));
  const title = useDraft(s.title ?? "", (t) => save({ title: t }));
  const meta = done
    ? s.doneOn === today ? "Done today" : `Done ${dayLabel(s.doneOn!, today)}`
    : s.plannedFor !== undefined ? `On ${dayLabel(s.plannedFor, today)}` : null;
  return (
    <li className={done ? "strip session-row crossed" : "strip session-row"}>
      <input
        type="checkbox"
        className="tick"
        aria-label={sessionBoxLabel(s.title, index)}
        checked={done}
        onChange={() => void write(() => setSessionDone(item.id, s.id, !done, today)).catch(() => {})}
      />
      <div className="strip-body">
        <input
          type="text"
          className="strip-title session-title"
          aria-label={`Title of session ${n}`}
          placeholder={`Session ${n}`}
          maxLength={MAX_SESSION_TITLE}
          autoFocus={autoFocus}
          value={title.value}
          onChange={(e) => title.set(e.target.value)}
          onBlur={title.flush}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
        />
        <SessionDetails n={n} stored={s.details ?? ""} offerAdd={!done} save={(d) => save({ details: d })} />
        {meta && <div className="strip-meta">{meta}</div>}
      </div>
      {!done && (
        <div className="strip-actions">
          <SessionMenu
            n={n}
            plannedFor={s.plannedFor}
            today={today}
            canRemove={count > 1}
            plan={(date) => save({ plannedFor: date })}
            remove={() => write(() => removeSession(item.id, s.id, today))}
          />
        </div>
      )}
    </li>
  );
}

/**
 * A session's details: under the title when set (cut short with "See more" when long), typed
 * straight into and saved on leaving the field; "+ Add details" when there are none (not on
 * a done session).
 */
function SessionDetails({
  n, stored, offerAdd, save,
}: { n: number; stored: string; offerAdd: boolean; save: (d: string) => Promise<void> }) {
  const draft = useDraft(stored, save);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Set by "+ Add details" / "See more": the field that appears takes the focus.
  const [wantFocus, setWantFocus] = useState(false);
  const ref = useGrow(draft.value);
  const long = draft.value.length > DETAILS_SHORT;

  if (!draft.value && !open) {
    // A done session offers no "+ Add details" (it would only clutter the list).
    if (!offerAdd) return null;
    return (
      <div className="strip-more">
        <button
          type="button"
          className="quiet-link"
          aria-label={`Add details to session ${n}`}
          onClick={() => {
            setWantFocus(true);
            setOpen(true);
          }}
        >
          + Add details
        </button>
      </div>
    );
  }
  if (long && !expanded) {
    return (
      <div className="session-details">
        <div className="session-details-short">{draft.value}</div>
        <div className="strip-more">
          <button
            type="button"
            className="quiet-link"
            aria-label={`See more: session ${n}`}
            onClick={() => {
              setWantFocus(true);
              setExpanded(true);
            }}
          >
            See more
          </button>
        </div>
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      autoFocus={wantFocus}
      rows={1}
      className="session-details session-details-field"
      aria-label={`Details of session ${n}`}
      placeholder="What is this session?"
      maxLength={MAX_SESSION_DETAILS}
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={() => {
        draft.flush();
        if (!draft.value) setOpen(false);
      }}
    />
  );
}

/** The session's calendar icon: "Do it on" (sets the day it is planned for), then Remove session. */
function SessionMenu({
  n, plannedFor, today, canRemove, plan, remove,
}: {
  n: number;
  plannedFor?: ISODate;
  today: ISODate;
  canRemove: boolean;
  plan: (date: ISODate | undefined) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const pressing = useRef(false);
  async function run(fn: () => Promise<void>, close: (refocus?: boolean) => void) {
    try {
      await fn();
      close();
    } catch {
      close(true); // the panel shows the save message
    }
  }
  return (
    <IconPopover icon={CALENDAR_GLYPH} label={`Plan session ${n}`} tooltip="Plan" groupLabel={`Plan session ${n}`}>
      {(close) => (
        <>
          <DayPart
            heading="Do it on"
            quick={[
              { text: "Today", date: today },
              { text: "Tomorrow", date: addDays(today, 1) },
              { text: "Next week", date: nextMonday(today) },
            ]}
            current={plannedFor}
            today={today}
            fieldLabel={`Day for session ${n}`}
            save={(date, c) => void run(() => plan(date), c)}
            clearable={plannedFor !== undefined}
            close={close}
            pressing={pressing}
          />
          {canRemove && (
            <>
              <hr />
              <button type="button" onPointerDown={() => (pressing.current = true)} onClick={() => void run(remove, close)}>
                Remove session
              </button>
            </>
          )}
        </>
      )}
    </IconPopover>
  );
}

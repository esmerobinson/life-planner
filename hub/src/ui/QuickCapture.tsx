import { useEffect, useRef, useState, type Ref } from "react";
import { createItem } from "../data/repo";
import { TIME_OF_DAY } from "../data/validate";
import { addDays } from "../domain/dates";
import type { ISODate } from "../domain/types";
import { SAVE_ERROR } from "./messages";

/*
 * One-tap quick add (Esme, 2026-11-17: "Adding a to do should be very easy on the phone app"; her
 * yes to the proposal). One box, the keyboard already up; Return saves it as a to-do in the Inbox
 * and the box is ready for the next one. Small optional chips: Today and Tomorrow pin it to that
 * day ("Do it on"), Time gives it the to-do's time on that day. "More options" opens the full
 * Add form. WORDING PROVISIONAL (for Esme / Design): "What's on your mind?", "Today", "Tomorrow",
 * "Time", "Added", "More options". The "Added" line's look is a placeholder.
 */

/** Where the half-typed entry is kept on this device (localStorage: written as she types, so a
 *  reload, the Mac's auto-update or the phone ending the app in the background loses nothing). */
export const QUICK_DRAFT_KEY = "esmeworld-quick-add";

export type QuickDay = "today" | "tomorrow" | null;

/** What is typed or chosen in the quick box. */
export interface QuickDraft {
  text: string;
  day: QuickDay;
  /** "HH:MM", or "" while the Time field is open and empty. */
  time: string;
  /** The Time field is open. */
  timeOn: boolean;
}

const EMPTY: QuickDraft = { text: "", day: null, time: "", timeOn: false };

/** The kept draft (an empty one if there is none, it can't be read, or storage is blocked). */
export function readQuickDraft(): QuickDraft {
  try {
    const raw = localStorage.getItem(QUICK_DRAFT_KEY);
    if (!raw) return { ...EMPTY };
    const d = JSON.parse(raw) as Partial<QuickDraft>;
    return {
      text: typeof d.text === "string" ? d.text : "",
      day: d.day === "today" || d.day === "tomorrow" ? d.day : null,
      time: typeof d.time === "string" ? d.time : "",
      timeOn: d.timeOn === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Keeps the draft (or forgets it when nothing is in it). Storage blocked: kept in memory only. */
export function writeQuickDraft(d: QuickDraft): void {
  try {
    if (!d.text && !d.day && !d.time && !d.timeOn) localStorage.removeItem(QUICK_DRAFT_KEY);
    else localStorage.setItem(QUICK_DRAFT_KEY, JSON.stringify(d));
  } catch {
    // A private window or blocked storage: the draft lives as long as the page.
  }
}

/** Sets the text of the kept draft (the full Add form, opened by More options, keeps it in step). */
export function setQuickDraftText(text: string): void {
  writeQuickDraft({ ...readQuickDraft(), text });
}

/** Forgets the kept draft. */
export function clearQuickDraft(): void {
  writeQuickDraft(EMPTY);
}

export function QuickCapture({
  today,
  onAdded,
  onMore,
  inputRef,
  autoFocus = false,
}: {
  today: ISODate;
  /** After each save (the shell re-reads its lists). */
  onAdded: () => void;
  /** "More options": the full Add form, with what was typed. */
  onMore: (draft: QuickDraft) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Focus the box when it appears (the + also focuses it within the tap, for iOS). */
  autoFocus?: boolean;
}) {
  const [draft, setDraftState] = useState<QuickDraft>(readQuickDraft);
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const timeRef = useRef<HTMLInputElement>(null);
  const focusTime = useRef(false);

  function setDraft(next: QuickDraft) {
    writeQuickDraft(next);
    setDraftState(next);
  }

  // Time opened by a tap: its field takes the focus (on a phone, the time wheel opens).
  useEffect(() => {
    if (draft.timeOn && focusTime.current) timeRef.current?.focus();
    focusTime.current = false;
  }, [draft.timeOn]);

  async function save(e: React.SyntheticEvent) {
    e.preventDefault();
    const title = draft.text.trim();
    if (!title || saving.current) return;
    const day = draft.day === "today" ? today : draft.day === "tomorrow" ? addDays(today, 1) : undefined;
    const time = draft.timeOn && day && TIME_OF_DAY.test(draft.time) ? draft.time : undefined;
    saving.current = true;
    setFailed(false);
    try {
      await createItem(
        {
          kind: "task",
          title,
          areaId: "inbox",
          priority: 2,
          links: [],
          ...(day ? { pinnedDate: day } : {}),
          ...(time ? { time } : {}),
        },
        today,
      );
    } catch {
      setFailed(true);
      return;
    } finally {
      saving.current = false;
    }
    // Ready for the next one: an empty box, no chips, still focused (the keyboard stays up).
    setDraft({ ...EMPTY });
    setAdded(true);
    onAdded();
  }

  function chooseDay(day: Exclude<QuickDay, null>) {
    setDraft({ ...draft, day: draft.day === day ? null : day });
  }

  function toggleTime() {
    if (draft.timeOn) return setDraft({ ...draft, timeOn: false, time: "" });
    focusTime.current = true;
    setDraft({ ...draft, timeOn: true });
  }

  return (
    <form className="quick-capture" noValidate onSubmit={(e) => void save(e)}>
      <label className="form-field quick-capture-field">
        <span className="form-label">What's on your mind?</span>
        <input
          ref={inputRef}
          type="text"
          data-focus-first=""
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="enter"
          value={draft.text}
          // Return saves. Not left to the form: with the Time field open there are two fields
          // and no submit button, and a browser then sends nothing on Return.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void save(e);
          }}
          onChange={(e) => {
            setAdded(false);
            setDraft({ ...draft, text: e.target.value });
          }}
        />
      </label>
      <div className="quick-capture-chips" role="group" aria-label="When">
        <button type="button" aria-pressed={draft.day === "today"} onClick={() => chooseDay("today")}>
          Today
        </button>
        <button type="button" aria-pressed={draft.day === "tomorrow"} onClick={() => chooseDay("tomorrow")}>
          Tomorrow
        </button>
        <button type="button" aria-pressed={draft.timeOn} onClick={toggleTime}>
          Time
        </button>
        {draft.timeOn && (
          <input
            ref={timeRef}
            type="time"
            aria-label="Time"
            className="quick-capture-time"
            value={draft.time}
            // A time needs a day: with none chosen it is today.
            onChange={(e) => setDraft({ ...draft, time: e.target.value, day: draft.day ?? (e.target.value ? "today" : null) })}
          />
        )}
      </div>
      {added && (
        <p role="status" className="quick-capture-added">
          Added
        </p>
      )}
      {failed && <p className="form-message">{SAVE_ERROR}</p>}
      <p className="quick-capture-more">
        <button type="button" className="quiet-link" onClick={() => onMore(draft)}>
          More options
        </button>
      </p>
    </form>
  );
}

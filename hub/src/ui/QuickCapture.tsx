import { useEffect, useRef, useState } from "react";
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
 * "Time", "Added", "More options", the Add button (named "Add to Inbox" for screen readers, as
 * the round + is already "Add"). The "Added" line's look is a placeholder; the Add button's
 * place (just after the box, on its row) is provisional for Design.
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

/** Letters only an IME picks for (Japanese kana, CJK ideographs, Hangul, Bopomofo). */
const IME_SCRIPT = /[\u3040-\u30ff\u3100-\u312f\u31a0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\uff66-\uff9f]/;

/** A Return that a real IME (Japanese, Chinese, Korean) uses to pick its characters: keyCode 229
 *  with those letters in the composition. Chrome sends it while composing; Safari and the Mac's
 *  WebKit just after the composition ends, so isComposing alone misses it there. iOS predictive
 *  text and autocorrect can mark a plain Return as composing too (Esme, 2026-11-23: "pressing
 *  enter on keyboard doesnt submit really"): that one adds. */
export function isImePick(e: { keyCode: number }, composition: string): boolean {
  return e.keyCode === 229 && IME_SCRIPT.test(composition);
}

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
  autoFocus = false,
}: {
  today: ISODate;
  /** After each save (the shell re-reads its lists). */
  onAdded: () => void;
  /** "More options": the full Add form, with what was typed. */
  onMore: (draft: QuickDraft) => void;
  /** Focus the box when it appears (the + also focuses it within the tap, for iOS). */
  autoFocus?: boolean;
}) {
  const [draft, setDraftState] = useState<QuickDraft>(readQuickDraft);
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const timeRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const focusTime = useRef(false);
  /** The IME's text in the box: being composed, or just picked (cleared by the next ordinary key). */
  const composition = useRef("");

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
    <form className="quick-capture" data-reload-safe="" noValidate onSubmit={(e) => void save(e)}>
      <div className="quick-capture-row">
        <label className="form-field quick-capture-field">
          <span className="form-label">What's on your mind?</span>
          <input
            ref={boxRef}
            type="text"
            data-focus-first=""
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="done"
            value={draft.text}
            onCompositionStart={(e) => (composition.current = e.data ?? "")}
            onCompositionUpdate={(e) => (composition.current = e.data ?? "")}
            onCompositionEnd={(e) => (composition.current = e.data ?? "")}
            // Return submits the form (the one way to save: the form's Add button is its submit
            // button, so the browser's own Return works from the Time field too). Done here as
            // well so a Return iOS marks as composing still submits; a real IME's pick doesn't.
            onKeyDown={(e) => {
              if (e.key !== "Enter") {
                if (e.keyCode !== 229) composition.current = "";
                return;
              }
              if (isImePick(e, composition.current)) return;
              composition.current = "";
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
            onChange={(e) => {
              setAdded(false);
              setDraft({ ...draft, text: e.target.value });
            }}
          />
        </label>
        {/* Esme, 2026-11-17: "needs to be add button"; 2026-11-23: "the submit button needs to be
            there": always the plain primary pill, never greyed out. The form's submit button, so
            it does what Return does; with the box empty it only puts the focus in the box.
            Pressing it never takes the focus from the box (so the phone's keyboard stays up);
            the tap puts it back too, within the tap. */}
        <button
          type="submit"
          className="quick-capture-add"
          aria-label="Add to Inbox"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => boxRef.current?.focus()}
        >
          Add
        </button>
      </div>
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

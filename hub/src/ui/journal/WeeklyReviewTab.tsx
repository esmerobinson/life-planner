import { liveQuery } from "dexie";
import { createContext, useContext, useEffect, useState } from "react";
import {
  listReviewWeeks, readWeeklyReview, removeWeeklyReviewVersion, reviewWeekDone, saveWeeklyReview, type ReviewWeek,
} from "../../data/repo";
import { addDays, mondayOf } from "../../domain/dates";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { CHOICES } from "../../journal/routine";
import {
  defaultReviewWeek, otherReviewWeek, reviewTitle, SLEEPS, WEEKLY_REVIEW_RULES, WEEKLY_TEXTS, weeklyReviewFields, YES_NO,
  type WeeklyReviewFields,
} from "../../journal/weeklyReview";
import { CompletedThisWeek } from "../whatIDid/CompletedThisWeek";
import { LOADING_LINE } from "./bits";
import { answer, FormBox, FormReadOnly, NoteBox, OptionButtons, useForm, WeekReviewBoxes, WeekReviewView, type FormSpec } from "./RoutineForms";
import { ROUTINE_WORDS as RW, WEEKLY_WORDS as W } from "./routineWording";
import "./routine.css";

// Weekly review v2 (Esme, 17 and 23 Nov 2026): its own Journal tab, submitted as a Mental health
// exercise (a done review ticks that day's Mental health work). PLACEHOLDER look and placement
// (magenta, the system font, no easing): only the journal's own pieces are reused; nothing new
// here is a design choice.
//
// Airtight like the daily log (RoutineForms' FormBox): saved sealed as she goes, shown again
// after a reload, a version per device, nothing ever cleared silently. What goes to Together is
// only "Weekly review done" (together/journalNotes.ts): nothing she answers here.

/** The week the box is for (its Monday), for "Completed this week". */
const ReviewWeekCtx = createContext<ISODate | null>(null);

const WEEKLY_SPEC: FormSpec<WeeklyReviewFields> = {
  rules: WEEKLY_REVIEW_RULES,
  normalise: weeklyReviewFields,
  save: saveWeeklyReview,
  remove: removeWeeklyReviewVersion,
  Fields: WeeklyReviewBoxes,
  View: WeeklyReviewView,
  doneTitle: W.done,
};

/**
 * The tab: the title of the week the box is for, a small switch to the other week, the box, and
 * every past review below (the earlier ones too, read-only). Which week opens: Friday to Sunday,
 * this week; Monday to Thursday, last week until last week's is done (journal/weeklyReview.ts).
 * Chosen once when the tab opens (and again at 3am), never while she is in it.
 */
export function WeeklyReviewTab({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const thisWeek = mondayOf(today);
  const [chosen, setChosen] = useState<{ today: ISODate; week: ISODate } | null>(null);
  useEffect(() => {
    let live = true;
    const pick = (done: boolean) => live && setChosen({ today, week: defaultReviewWeek(today, done) });
    void reviewWeekDone(jk, addDays(mondayOf(today), -7)).then(pick, () => pick(false));
    return () => {
      live = false;
    };
  }, [jk, today]);
  const week = chosen && chosen.today === today ? chosen.week : null;
  return (
    <>
      <section className="routine-placeholder" aria-label={W.tab}>
        {week === null ? (
          <p className="journal-muted" role="status">
            {LOADING_LINE}
          </p>
        ) : (
          <>
            <h3>{reviewTitle(week)}</h3>
            <button type="button" className="btn-secondary routine-switch" onClick={() => setChosen({ today, week: otherReviewWeek(today, week) })}>
              {week === thisWeek ? W.switchToLast : W.switchToThis}
            </button>
            <ReviewBox key={week} jk={jk} deviceId={deviceId} week={week} today={today} />
          </>
        )}
      </section>
      {week !== null && <PastReviews jk={jk} shown={week} />}
    </>
  );
}

function ReviewBox({ jk, deviceId, week, today }: { jk: JournalKey; deviceId: string; week: ISODate; today: ISODate }) {
  const day = useForm(() => readWeeklyReview(jk, week), [jk, week]);
  // "Completed this week" is for the week shown; its days are named from today.
  return (
    <ReviewWeekCtx.Provider value={week}>
      <TodayCtx.Provider value={today}>
        {/* Every new version is filed under the week's Monday (journal/weeklyReview.ts). */}
        {day && <FormBox jk={jk} deviceId={deviceId} day={day} newDate={week} spec={WEEKLY_SPEC} />}
      </TodayCtx.Provider>
    </ReviewWeekCtx.Provider>
  );
}
const TodayCtx = createContext<ISODate | null>(null);

/** Every review but the one in the box, newest week first: each opens to read (nothing hidden). */
function PastReviews({ jk, shown }: { jk: JournalKey; shown: ISODate }) {
  const [weeks, setWeeks] = useState<ReviewWeek[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => listReviewWeeks(jk)).subscribe({ next: setWeeks, error: () => undefined });
    return () => sub.unsubscribe();
  }, [jk]);
  if (!weeks) return null;
  const items = weeks.flatMap((w) => [
    ...(w.v2 && w.week !== shown ? [<FormReadOnly key={`${w.week}|v2`} summary={reviewTitle(w.week)} day={w.v2} View={WeeklyReviewView} />] : []),
    ...(w.v1 ? [<FormReadOnly key={`${w.week}|v1`} summary={`${reviewTitle(w.week)} ${W.earlierQuestions}`} day={w.v1} View={WeekReviewView} />] : []),
  ]);
  return (
    <section className="routine-placeholder" aria-label={W.past}>
      <h3>{W.past}</h3>
      {items.length === 0 ? <p className="journal-muted">{W.pastEmpty}</p> : <ul className="routine-past">{items.map((x) => <li key={x.key}>{x}</li>)}</ul>}
    </section>
  );
}

// ---- the boxes, in her order (all optional) -------------------------------------------------------

function WeeklyReviewBoxes({ value, set, flush }: { value: WeeklyReviewFields; set: (f: WeeklyReviewFields, now?: boolean) => void; flush: () => void }) {
  const week = useContext(ReviewWeekCtx);
  const today = useContext(TodayCtx);
  const text = (k: keyof typeof WEEKLY_TEXTS, label: string, rows?: number) => (
    <NoteBox label={label} value={value[k]} max={WEEKLY_TEXTS[k]} rows={rows} onChange={(t) => set({ ...value, [k]: t })} onBlur={flush} />
  );
  // A box opened by "Yes" stays open while it holds words, whatever she picks: her words are never hidden.
  const open = (yes: boolean, ...keys: (keyof typeof WEEKLY_TEXTS)[]) => yes || keys.some((k) => value[k] !== "");
  return (
    <>
      <OptionButtons label={W.selfHarm} options={YES_NO} names={W.yesNo} value={value.selfHarm} onPick={(c) => set({ ...value, selfHarm: c }, true)} />
      {open(value.selfHarm === "yes", "selfHarmWhat") && text("selfHarmWhat", W.selfHarmWhat)}
      <OptionButtons label={W.urges} options={YES_NO} names={W.yesNo} value={value.urges} onPick={(c) => set({ ...value, urges: c }, true)} />
      {text("urgesNote", W.urgesNote)}
      <OptionButtons label={W.fight} options={YES_NO} names={W.yesNo} value={value.fight} onPick={(c) => set({ ...value, fight: c }, true)} />
      {open(value.fight === "yes", "fightAbout", "fightTrigger", "fightResolved") && (
        <>
          {text("fightAbout", W.fightAbout)}
          {text("fightTrigger", W.fightTrigger)}
          {text("fightResolved", W.fightResolved)}
        </>
      )}
      <OptionButtons label={W.productive} options={CHOICES} names={RW.choice} value={value.productive} onPick={(c) => set({ ...value, productive: c }, true)} />
      {text("achieved", W.achieved)}
      {text("struggled", W.struggled)}
      {/* Read-only, never part of the answers (so never anywhere near Together). */}
      {week && today && <CompletedThisWeek today={today} week={week} />}
      <WeekReviewBoxes value={value} set={set} flush={flush} />
      {text("dbt", W.dbt)}
      <OptionButtons label={W.sleep} options={SLEEPS} names={W.sleepChoice} value={value.sleep} onPick={(c) => set({ ...value, sleep: c }, true)} />
      {text("sleepNote", W.sleepNote)}
      {text("proud", W.proud)}
      {text("more", W.more, 6)}
    </>
  );
}

/** A v2 review, read-only: each question with her answer, and every box she wrote in. */
export function WeeklyReviewView({ fields }: { fields: WeeklyReviewFields }) {
  const f = weeklyReviewFields(fields);
  const pick = <T extends string>(names: Record<T, string>, v: T | null) => (v === null ? "" : names[v]);
  const rows: [string, string, [string, string][]][] = [
    [W.selfHarm, pick(W.yesNo, f.selfHarm), [[W.selfHarmWhat, f.selfHarmWhat]]],
    [W.urges, pick(W.yesNo, f.urges), [[W.urgesNote, f.urgesNote]]],
    [W.fight, pick(W.yesNo, f.fight), [[W.fightAbout, f.fightAbout], [W.fightTrigger, f.fightTrigger], [W.fightResolved, f.fightResolved]]],
    [W.productive, pick(RW.choice, f.productive), [[W.achieved, f.achieved], [W.struggled, f.struggled]]],
  ];
  const after: [string, string, [string, string][]][] = [
    [W.dbt, f.dbt, []],
    [W.sleep, pick(W.sleepChoice, f.sleep), [[W.sleepNote, f.sleepNote]]],
    [W.proud, f.proud, []],
    [W.more, f.more, []],
  ];
  const item = ([q, a, subs]: [string, string, [string, string][]]) => (
    <li key={q}>
      <p className="journal-q">{q}</p>
      {answer(a)}
      {subs.filter(([, t]) => t.trim() !== "").map(([label, t]) => (
        <div key={label}>
          <p className="journal-q routine-sub">{label}</p>
          <p className="journal-past-answer routine-note">{t}</p>
        </div>
      ))}
    </li>
  );
  return (
    <>
      <ol className="journal-answers routine-answers">{rows.map(item)}</ol>
      <WeekReviewView fields={f} />
      <ol className="journal-answers routine-answers">{after.map(item)}</ol>
    </>
  );
}

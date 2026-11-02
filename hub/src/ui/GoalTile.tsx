import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import {
  addMonthGoal, minusOne, planMonth, plusOne, removeMonthGoal, setMonthStep, updateMonthGoal, type MonthEdit,
} from "../data/repo";
import { monthName, shortDate } from "../domain/display";
import { monthOf } from "../domain/dates";
import {
  canPlanMonth, countUnknown, dailyStatus, goalsIn, isAutoCount, isDaily, monthCount, monthDots, monthGoalDone, monthsInARowHit,
  monthSummary, type GoalSources,
} from "../domain/goalCounts";
import { milestoneProgress } from "../domain/progress";
import type { CountSource, Goal, ISODate, Item, MonthGoal } from "../domain/types";
import { areaLabel } from "./GoalProgress";
import { NAV } from "./areas";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { ProgressBar } from "./ProgressBar";
import { Streak } from "./Streak";
import { NOT_AVAILABLE } from "./journal/JournalStrip";

/** "a November goal", "an October goal". */
const article = (month: string) => (/^[AEIOU]/.test(month) ? "an" : "a");
const pct = (r: number) => `${Math.round(Math.min(1, Math.max(0, r)) * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The kind chip: "By 31 Dec", "Daily" or "Ongoing". */
export function goalKindLabel(goal: Goal, today: ISODate): string {
  if (isDaily(goal)) return "Daily";
  if (goal.kind === "finite" && goal.deadline) return `By ${shortDate(goal.deadline, today)}`;
  return "Ongoing";
}

/**
 * The line under an automatic count, from its sources (mockup wording where it has one):
 * "Counts itself: morning pages or check-in", "…: exercises, Mind to-dos, Mind habits",
 * "…: today's exercise card, or a linked to-do".
 */
export function countsItselfText(goal: Goal): string {
  const daily = isDaily(goal);
  const part = (s: CountSource): string => {
    if (s === "journal") return "morning pages or check-in";
    if (s === "exercise") return daily ? "today's exercise card" : "exercises";
    if (s === "linked") return daily ? "a linked to-do" : "linked to-dos";
    const a = areaLabel(s.area);
    return `${a} to-dos, ${a} habits`;
  };
  return `Counts itself: ${(goal.countsFrom ?? []).map(part).join(daily ? ", or " : ", ")}`;
}

/** Opens the goal in the side panel (a plain link outside the shell). */
export function GoalLink({ goal, className }: { goal: Goal; className?: string }) {
  const panel = usePanel();
  return (
    <Link
      className={className}
      to={panel ? panel.href(goal.id) : { search: `?open=${encodeURIComponent(goal.id)}` }}
      onClick={(e: MouseEvent) => {
        if (!panel || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        panel.open(goal.id);
      }}
    >
      {goal.title}
    </Link>
  );
}

/**
 * The month dots (VISUAL-LANGUAGE.md "Goals redesign"): the last six months, --green where
 * that month's goal was hit, this month outlined; then "N months in a row".
 */
export function MonthDots({ goal, today, sources }: { goal: Goal; today: ISODate; sources: GoalSources }) {
  const dots = monthDots(goal, today, sources);
  const n = monthsInARowHit(goal, today, sources);
  return (
    <span className="goal-dots" title="Months you hit the monthly goal">
      <span className="goal-dots-row" aria-hidden="true">
        {dots.map((d) => (
          <span key={d.month} className={`goal-dot${d.hit ? " on" : ""}${d.now ? " now" : ""}`} />
        ))}
      </span>
      {n > 0 ? (
        <span className="goal-muted">{`${plural(n, "month")} in a row`}</span>
      ) : (
        <span className="visually-hidden">No months in a row yet</span>
      )}
    </span>
  );
}

/** One count: a tick when reached, "Title n / target", +1 (and −1) or "Counts itself: …". */
function CountItem({
  goal, m, sources, today, write,
}: { goal: Goal; m: MonthGoal; sources: GoalSources; today: ISODate; write: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const auto = isAutoCount(goal, m);
  const n = monthCount(goal, m, sources);
  const unknown = countUnknown(goal, m, sources);
  const done = !unknown && monthGoalDone(goal, m, sources);
  const current = m.month === monthOf(today);
  // A daily goal counts days: +1 once a day, and −1 takes today back off (review M4).
  const daily = isDaily(goal);
  const loggedToday = m.log?.includes(today) ?? false;
  return (
    <li className="goal-mitem">
      <span className={done ? "tick-auto tick-sm is-done" : "tick-auto tick-sm"} aria-hidden="true">
        {done && "✓"}
      </span>
      <span className="goal-mitem-title">
        {m.title} <b>{`${unknown ? "—" : n} / ${m.target ?? 0}`}</b>
        {done && <span className="visually-hidden"> (reached)</span>}
      </span>
      <span className="goal-mitem-act">
        {!auto && current && (daily ? loggedToday : (m.log?.length ?? 0) > 0) && (
          <button type="button" className="goal-minus" aria-label={`Undo the last +1 on ${m.title}`} onClick={() => void write(() => minusOne(goal.id, m.id))}>
            −1
          </button>
        )}
        {!auto && current && !(daily && loggedToday) && (
          <button type="button" className="goal-plus" aria-label={`+1 ${m.title}`} onClick={() => void write(() => plusOne(goal.id, m.id, today))}>
            +1
          </button>
        )}
      </span>
      {auto && (
        <span className="goal-auto">{unknown ? `${countsItselfText(goal)} · ${NOT_AVAILABLE}` : countsItselfText(goal)}</span>
      )}
    </li>
  );
}

/**
 * A tick box she can tick, drawn like the read-only one (the box with a ✓ when ticked, as the
 * mockups show it), so it reads on mint and --row alike.
 */
export function TickBox({
  checked, label, onChange, small = false,
}: { checked: boolean; label: string; onChange: (next: boolean) => void; small?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`tick-auto tick-button${small ? " tick-sm" : ""}${checked ? " is-done" : ""}`}
      onClick={() => onChange(!checked)}
    >
      {checked && <span aria-hidden="true">✓</span>}
    </button>
  );
}

/** Reports a month-goal change made in Edit: its save, and (once saved) what to record for Cancel. */
export type TrackEdit = (saved: Promise<boolean>, edit: () => MonthEdit) => void;

function StepItem({ goal, m, write }: { goal: Goal; m: MonthGoal; write: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const done = m.done === true;
  return (
    <li className={done ? "goal-mitem is-done" : "goal-mitem"}>
      <TickBox small checked={done} label={m.title} onChange={(next) => void write(() => setMonthStep(goal.id, m.id, next))} />
      <span className="goal-mitem-title">{m.title}</span>
      <span />
    </li>
  );
}

/** Edit mode (goal panel): the title (and a count's target) as fields that save when left, and Remove. */
function EditItem({
  goal, m, write, track,
}: { goal: Goal; m: MonthGoal; write: (fn: () => Promise<unknown>) => Promise<boolean>; track?: TrackEdit }) {
  const [title, setTitle] = useState(m.title);
  const [target, setTarget] = useState(String(m.target ?? ""));
  useEffect(() => setTitle(m.title), [m.title]);
  useEffect(() => setTarget(String(m.target ?? "")), [m.target]);
  return (
    <li className="goal-mitem goal-mitem-edit">
      <input
        type="text"
        aria-label={`Title of ${m.title}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title.trim() !== m.title) {
            const saved = write(() => updateMonthGoal(goal.id, m.id, { title }));
            track?.(saved, () => ({ kind: "retitle", id: m.id, from: m.title, to: title.trim() }));
          } else setTitle(m.title);
        }}
      />
      {m.kind === "count" ? (
        <input
          type="number"
          min={1}
          step={1}
          aria-label={`Target for ${m.title}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => {
            const t = Number(target);
            if (Number.isInteger(t) && t >= 1 && t !== m.target) {
              const saved = write(() => updateMonthGoal(goal.id, m.id, { target: t }));
              if (m.target !== undefined) track?.(saved, () => ({ kind: "retarget", id: m.id, from: m.target!, to: t }));
            } else setTarget(String(m.target ?? ""));
          }}
        />
      ) : (
        <span />
      )}
      <button
        type="button"
        className="btn-secondary"
        aria-label={`Remove ${m.title}`}
        onClick={() => {
          const saved = write(() => removeMonthGoal(goal.id, m.id));
          const index = Math.max(0, (goal.monthGoals ?? []).findIndex((x) => x.id === m.id));
          track?.(saved, () => ({ kind: "remove", entry: m, index }));
        }}
      >
        Remove
      </button>
    </li>
  );
}

/** "+ Add a <Month> goal": Count or Step, a title, and a target for a count. */
function AddMonthGoal({
  goal, today, write, track,
}: { goal: Goal; today: ISODate; write: (fn: () => Promise<unknown>) => Promise<boolean>; track?: TrackEdit }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MonthGoal["kind"]>("count");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const month = monthName(today);
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);
  const t = Number(target);
  const ready = title.trim() !== "" && (kind === "step" || (Number.isInteger(t) && t >= 1));
  if (!open) {
    return (
      <button type="button" className="quiet-link goal-add-link" onClick={() => setOpen(true)}>
        {`+ Add ${article(month)} ${month} goal`}
      </button>
    );
  }
  return (
    <form
      className="goal-add-form"
      aria-label={`Add ${article(month)} ${month} goal`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        let id = "";
        const saved = write(async () => {
          id = await addMonthGoal(goal.id, { kind, title, ...(kind === "count" ? { target: t } : {}) }, today);
        });
        track?.(saved, () => ({ kind: "add", id }));
        void saved.then((ok) => {
          if (!ok) return;
          setTitle("");
          setTarget("");
          setOpen(false);
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <div className="goal-add-kinds" role="group" aria-label="Kind">
        <button type="button" aria-pressed={kind === "count"} onClick={() => setKind("count")}>
          Count
        </button>
        <button type="button" aria-pressed={kind === "step"} onClick={() => setKind("step")}>
          Step
        </button>
      </div>
      <input ref={titleRef} type="text" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      {kind === "count" && (
        <input type="number" min={1} step={1} aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value)} />
      )}
      <div className="goal-add-actions">
        <button type="submit" disabled={!ready}>
          Add
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The "<Month> goals" box (a --row box): this month's counts and steps, "N of M done",
 * "Plan <Month>" at the start of a month that has none yet (last month's counts), and
 * "+ Add a <Month> goal". In the goal panel's Edit mode each one can be renamed, re-targeted
 * or removed.
 */
export function MonthGoalsBox({
  goal, today, sources, onChanged, editing = false, track,
}: {
  goal: Goal; today: ISODate; sources: GoalSources; onChanged: () => Promise<void>; editing?: boolean;
  /** Edit mode only: told about each change made, so Cancel can undo just those. */
  track?: TrackEdit;
}) {
  const { attempt, saveError } = useSaveError();
  const month = monthName(today);
  const mine = goalsIn(goal, monthOf(today));
  const done = mine.filter((m) => monthGoalDone(goal, m, sources)).length;
  // An older goal with only a monthly target (before monthly goals): its count, as the goal cards showed it.
  const legacy = mine.length === 0 ? monthSummary(goal, monthOf(today), sources) : null;
  async function write(fn: () => Promise<unknown>): Promise<boolean> {
    const ok = await attempt(fn);
    if (ok) await onChanged();
    return ok;
  }
  return (
    <div className="goal-month">
      <div className="goal-month-head">
        <span>{`${month} goals`}</span>
        {mine.length > 0 && <span className="goal-muted">{`${done} of ${mine.length} done`}</span>}
      </div>
      {mine.length > 0 && (
        <ul className="goal-mitems" aria-label={`${month} goals`}>
          {mine.map((m) =>
            editing ? (
              <EditItem key={m.id} goal={goal} m={m} write={write} track={track} />
            ) : m.kind === "count" ? (
              <CountItem key={m.id} goal={goal} m={m} sources={sources} today={today} write={write} />
            ) : (
              <StepItem key={m.id} goal={goal} m={m} write={write} />
            ),
          )}
        </ul>
      )}
      {legacy && (
        <ul className="goal-mitems" aria-label={`${month} goals`}>
          <li className="goal-mitem">
            <span className={legacy.n >= legacy.of ? "tick-auto tick-sm is-done" : "tick-auto tick-sm"} aria-hidden="true">
              {legacy.n >= legacy.of && "✓"}
            </span>
            <span className="goal-mitem-title">{`${month}: ${legacy.n} of ${legacy.of}`}</span>
            <span />
          </li>
        </ul>
      )}
      {canPlanMonth(goal, today) && (
        <button type="button" className="goal-plan" onClick={() => void write(() => planMonth(goal.id, today))}>
          {`Plan ${month}`}
        </button>
      )}
      {saveError && <p className="form-message">{saveError}</p>}
      <AddMonthGoal goal={goal} today={today} write={write} track={editing ? track : undefined} />
    </div>
  );
}

/** "Overall": the finite goal's bar, a daily goal's streak, or "ongoing". */
export function GoalOverall({ goal, items, today, sources }: { goal: Goal; items: Item[]; today: ISODate; sources: GoalSources }) {
  if (goal.kind === "finite" && !isDaily(goal)) {
    const m = milestoneProgress(goal, items);
    const ratio = m?.ratio ?? 0;
    return (
      <div className="goal-overall">
        <div className="goal-lbl">
          <span>Overall</span>
          <span>{pct(ratio)}</span>
        </div>
        <ProgressBar ratio={ratio} label={`Overall ${m?.done ?? 0}/${m?.total ?? 0}`} />
      </div>
    );
  }
  const st = isDaily(goal) ? dailyStatus(goal, today, sources) : null;
  const streak = st && <Streak n={st.streak} week={st.week} />;
  const shows = st !== null && (st.streak > 0 || st.week.some(Boolean));
  return (
    <div className="goal-lbl">
      <span>Overall</span>
      <span>{shows ? streak : "ongoing"}</span>
    </div>
  );
}

/**
 * A goal in Home's "Goals this month" column (VISUAL-LANGUAGE.md "Home 'Goals this month'
 * column: C"; mockup-goals-choices.html section 2 tab C): a thin area-colour band with the
 * icon and title, "n / of this month" (its first count, else its steps) with a daily goal's
 * streak, a thin bar, the month dots. The whole card opens the goal.
 */
export function GoalMiniCard({ goal, today, sources }: { goal: Goal; today: ISODate; sources: GoalSources }) {
  const nav = NAV.find((n) => n.id === goal.areaId);
  // Before any monthly goals, monthSummary falls back to the older monthly target (fix round 1, I2).
  const sum = monthSummary(goal, monthOf(today), sources);
  const st = isDaily(goal) ? dailyStatus(goal, today, sources) : null;
  return (
    <li className="goal-mini">
      <div className="goal-mini-band" style={{ background: nav?.tile }}>
        {nav && <img src={nav.icon} alt="" width={18} height={18} />}
        <GoalLink goal={goal} className="goal-mini-link" />
      </div>
      <div className="goal-mini-body">
        {(sum || st) && (
          <div className="goal-mini-line">
            <span>{sum ? `${sum.unknown ? "—" : sum.n} / ${sum.of} this month` : ""}</span>
            {st && <Streak n={st.streak} week={st.week} />}
          </div>
        )}
        {sum && !sum.unknown && <ProgressBar ratio={sum.of > 0 ? sum.n / sum.of : 0} label={`${goal.title} this month ${sum.n}/${sum.of}`} />}
        <MonthDots goal={goal} today={today} sources={sources} />
      </div>
    </li>
  );
}

/**
 * A goal on the Goals page (VISUAL-LANGUAGE.md "Goals redesign", mockup-goals-choices.html
 * section 1 tab A · Colour band): a --panel tile, the area-colour band with the area icon and
 * the bold title (opens the goal), the kind chip, Overall, the month dots, then the
 * "<Month> goals" box. Daily goals have the 3px mint outline.
 */
export function GoalTile({
  goal, items, today, sources, onChanged,
}: { goal: Goal; items: Item[]; today: ISODate; sources: GoalSources; onChanged: () => Promise<void> }) {
  const nav = NAV.find((n) => n.id === goal.areaId);
  return (
    <li className={isDaily(goal) ? "goal-tile-a is-daily" : "goal-tile-a"}>
      <div className="goal-band" style={{ background: nav?.tile }}>
        {nav && <img src={nav.icon} alt="" width={28} height={28} />}
        <h3 className="goal-band-title">
          <GoalLink goal={goal} />
        </h3>
      </div>
      <div className="goal-tile-body">
        <div>
          <span className="goal-chip">{goalKindLabel(goal, today)}</span>
        </div>
        <GoalOverall goal={goal} items={items} today={today} sources={sources} />
        <MonthDots goal={goal} today={today} sources={sources} />
        <MonthGoalsBox goal={goal} today={today} sources={sources} onChanged={onChanged} />
      </div>
    </li>
  );
}

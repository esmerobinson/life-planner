import type { MouseEvent, ReactNode } from "react";
import { Star } from "./bits";

/** The tick box's tooltip: it is never ticked by hand. */
export const TICKS_ITSELF = "Ticks itself when you've done it";

/** Said by the empty box while the journal is locked (or not set up) on this device. */
export const NOT_AVAILABLE = "Not available until the journal is unlocked";
/** Said by the box's space while what is done today is still being read. */
export const LOADING = "Loading";

/** What a row's tick box knows: done today, not yet, or nothing (locked, still loading). */
export type TickState = "done" | "todo" | "locked" | "loading";

/** "done" / "todo" once known; `undefined` while loading. */
export const tickState = (done: boolean | undefined): TickState => (done === undefined ? "loading" : done ? "done" : "todo");

/**
 * The Journal rows' tick box (VISUAL-LANGUAGE.md "Journal rows"): the task strips' tick, but
 * read-only. It ticks itself when that part of the Journal is done today; it is not a control
 * (no focus, aria-disabled) and clicking it never changes anything. Done shows a ✓ in --text
 * (controller call, 2026-11-02: the plain green fill vanished on mint), as the Journal's own
 * "Done for today" box does. Locked: the empty box, but not a checkbox (it isn't "not done",
 * it's unknown). Loading: only the box's space, so nothing pops from unticked to ticked.
 */
export function ReadOnlyTick({ state, title }: { state: TickState; title: string }) {
  if (state === "loading") return <span className="tick-auto-space" role="img" aria-label={LOADING} />;
  if (state === "locked") return <span className="tick-auto" role="img" aria-label={NOT_AVAILABLE} title={NOT_AVAILABLE} />;
  const done = state === "done";
  return (
    <span
      className={done ? "tick-auto is-done" : "tick-auto"}
      role="checkbox"
      aria-checked={done}
      aria-disabled="true"
      aria-label={`${title} done today`}
      title={TICKS_ITSELF}
    >
      {done && <span aria-hidden="true">✓</span>}
    </span>
  );
}

/** "★ N" on the right: days in a row (star is the magenta placeholder); nothing at 0. */
export function StreakBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  const words = `${n} ${n === 1 ? "day" : "days"} in a row`;
  return (
    <span className="journal-row-streak" title={words}>
      <Star /> <span aria-hidden="true">{n}</span>
      <span className="visually-hidden">{words}</span>
    </span>
  );
}

interface StripProps {
  title: string;
  tick: TickState;
  streak: number;
  meta?: ReactNode;
}

/**
 * One Journal row on Home: the mint strip (tick, title, small line, ★ N). The title is a
 * button and the whole strip opens that Journal section.
 */
export function JournalRow({ title, tick, streak, meta, onOpen }: StripProps & { onOpen: () => void }) {
  const onStrip = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("button")) return; // the title's own click
    onOpen();
  };
  return (
    <li className="strip journal-row journal-row-open" onClick={onStrip}>
      <ReadOnlyTick state={tick} title={title} />
      <div className="strip-body">
        <button type="button" className="strip-title strip-open" onClick={onOpen}>
          {title}
        </button>
        {meta && <div className="strip-meta">{meta}</div>}
      </div>
      <div className="strip-actions">
        <StreakBadge n={streak} />
      </div>
    </li>
  );
}

/**
 * The same strip as a Journal section's heading: the title is the section's h2 (`id` labels
 * the section), with the section's detail below it.
 */
export function JournalStripHead({ id, title, tick, streak, meta }: StripProps & { id: string }) {
  return (
    <div className="strip journal-row">
      <ReadOnlyTick state={tick} title={title} />
      <div className="strip-body">
        <h2 id={id} className="strip-title journal-row-heading">
          {title}
        </h2>
        {meta && <div className="strip-meta">{meta}</div>}
      </div>
      <div className="strip-actions">
        <StreakBadge n={streak} />
      </div>
    </div>
  );
}

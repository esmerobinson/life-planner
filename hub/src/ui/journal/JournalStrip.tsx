import type { MouseEvent, ReactNode } from "react";
import { Star } from "./bits";

/** The tick box's tooltip: it is never ticked by hand. */
export const TICKS_ITSELF = "Ticks itself when you've done it";

/**
 * The Journal rows' tick box (VISUAL-LANGUAGE.md "Journal rows"): the task strips' tick, but
 * read-only. It ticks itself when that part of the Journal is done today; it is not a control
 * (no focus, aria-disabled) and clicking it never changes anything.
 */
export function ReadOnlyTick({ done, title }: { done: boolean; title: string }) {
  return (
    <span
      className={done ? "tick-auto is-done" : "tick-auto"}
      role="checkbox"
      aria-checked={done}
      aria-disabled="true"
      aria-label={`${title} done today`}
      title={TICKS_ITSELF}
    />
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
  done: boolean;
  streak: number;
  meta?: ReactNode;
}

/**
 * One Journal row on Home: the mint strip (tick, title, small line, ★ N). The title is a
 * button and the whole strip opens that Journal section.
 */
export function JournalRow({ title, done, streak, meta, onOpen }: StripProps & { onOpen: () => void }) {
  const onStrip = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("button")) return; // the title's own click
    onOpen();
  };
  return (
    <li className="strip journal-row journal-row-open" onClick={onStrip}>
      <ReadOnlyTick done={done} title={title} />
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
export function JournalStripHead({ id, title, done, streak, meta }: StripProps & { id: string }) {
  return (
    <div className="strip journal-row">
      <ReadOnlyTick done={done} title={title} />
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

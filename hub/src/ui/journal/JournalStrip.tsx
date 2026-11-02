import type { MouseEvent, ReactNode } from "react";

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
 * `inLink`: inside a Journal tab (a link) the box is only a picture; the tab says "done today".
 */
export function ReadOnlyTick({ state, title, inLink = false }: { state: TickState; title: string; inLink?: boolean }) {
  if (state === "loading") {
    return <span className="tick-auto-space" {...(inLink ? { "aria-hidden": true } : { role: "img", "aria-label": LOADING })} />;
  }
  if (state === "locked") {
    return (
      <span className="tick-auto" title={NOT_AVAILABLE} {...(inLink ? { "aria-hidden": true } : { role: "img", "aria-label": NOT_AVAILABLE })} />
    );
  }
  const done = state === "done";
  const glyph = done && <span aria-hidden="true">✓</span>;
  if (inLink) {
    return (
      <>
        <span className={done ? "tick-auto is-done" : "tick-auto"} aria-hidden="true" title={TICKS_ITSELF}>
          {glyph}
        </span>
        {done && <span className="visually-hidden">(done today)</span>}
      </>
    );
  }
  return (
    <span
      className={done ? "tick-auto is-done" : "tick-auto"}
      role="checkbox"
      aria-checked={done}
      aria-disabled="true"
      aria-label={`${title} done today`}
      title={TICKS_ITSELF}
    >
      {glyph}
    </span>
  );
}

/**
 * "🔒 private" on a strip's small line. The emoji sits in its own span that adds no line
 * height, so the line is exactly as tall as a task strip's due line (the emoji font's taller
 * line made these strips 5px taller, 2026-11-02).
 */
export function Private() {
  return (
    <>
      <span className="strip-emoji">🔒</span> private
    </>
  );
}

/**
 * One Journal row (Home, Today, Mind's Habits): a mint strip exactly like a task strip, with
 * the read-only tick, the title (a button) and its small line, and `right` on the right (the
 * streak; on Mind, the habit's session count). The whole strip opens that Journal tab.
 */
export function JournalRow({
  title, tick, meta, right, onOpen,
}: { title: string; tick: TickState; meta?: ReactNode; right?: ReactNode; onOpen: () => void }) {
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
      <div className="strip-actions">{right}</div>
    </li>
  );
}

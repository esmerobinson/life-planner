import type { ReactNode } from "react";
import journalIcon from "../../assets/icons/journal.svg";
import type { ISODate } from "../../domain/types";

/** "Wednesday 28 October" for a calendar date (no timezone shift). */
export function longDate(date: ISODate): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "October", or "October 2025" outside the current year. */
export function monthLabel(month: string, today: ISODate): string {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(y!, m! - 1, 1).toLocaleDateString("en-GB", { month: "long" });
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${y}`;
}

/** The section head from the mockup: Journal tile (violet, journal icon), title, a small line. */
export function JournalHead({ id, title, sub }: { id: string; title: string; sub: ReactNode }) {
  return (
    <div className="journal-head">
      <span className="journal-tile">
        <img src={journalIcon} alt="" />
      </span>
      <div>
        <h2 id={id} className="journal-big">
          {title}
        </h2>
        <div className="journal-muted">{sub}</div>
      </div>
    </div>
  );
}

/** The placeholder star (magenta until Esme picks star art). */
export function Star() {
  return <span className="journal-star" aria-hidden="true" />;
}

/** The done box: a tick, a bold line and a small line under it. */
export function DoneBox({ title, line, star = false }: { title: string; line?: string | null; star?: boolean }) {
  return (
    <div className="journal-done">
      <span className="journal-tick" aria-hidden="true">
        ✓
      </span>
      <div>
        <b>{title}</b>
        {line && (
          <div className="journal-muted">
            {star && <Star />} {line}
          </div>
        )}
      </div>
    </div>
  );
}

/** A prompt's text, with the bank's *emphasis* shown as emphasis. */
export function PromptText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p))}
    </>
  );
}

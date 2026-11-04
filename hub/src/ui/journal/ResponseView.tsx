import type { PartAnswer, ResponseVersion } from "../../data/repo";
import { longDate } from "./bits";

/** A part left empty, when reading back. */
export const NOT_ANSWERED = "Not answered";
/** Over another version of a response that was never submitted (Esme, 2026-11-04: nothing hidden). */
export const UNSENT_DRAFT = "Unsent draft";
/** Over another submitted version of the same card on the same day (another device's). */
export const ALSO_SUBMITTED = "Also submitted";
/** On a card whose parts changed since she answered: what she wrote then, read-only. */
export const EARLIER_ANSWER = "Your earlier answer (the card has changed since)";

/**
 * A card's or a response's title wherever it is listed: its book (when the set names books),
 * "Day N" and its theme, e.g. "Pretend DBT book · Day 1 · Pretend costs". Two books are each
 * numbered from Day 1, so a bare "Day 1" could be either (Esme, 2026-11-04: "day two doesnt
 * show as this one"). A response from the earliest (version 1) cards that no card in the set
 * matches says so, rather than passing for another book's Day N.
 */
export function cardTitle(
  e: { id: string; day: number | null; theme: string },
  book: string | undefined,
  inSet: boolean,
): string {
  if (!inSet && e.day !== null && e.id === `day-${e.day}`) return `Earlier card (day ${e.day}) · ${e.theme}`;
  return [book ?? "", e.day !== null ? `Day ${e.day}` : "", e.theme].filter(Boolean).join(" · ");
}

/**
 * A response to an exercise card, read-only (Past exercises, All cards, Read back): the one
 * text, or each part's prompt and answer (a list as its numbered lines, a rating as "N out of
 * 10", a choice as the option chosen). Always from what is stored, with its own prompts, never
 * from the card as it is now. A text kept from before the card had parts shows too.
 */
export function ResponseView({ text, parts }: { text: string; parts: PartAnswer[] | null }) {
  if (!parts) return <p className="journal-past-answer">{text}</p>;
  return (
    <>
      {text.trim() !== "" && <p className="journal-past-answer">{text}</p>}
      <ol className="exercise-part-answers">
        {parts.map((a, i) => (
          <li key={i}>
            <p className="exercise-label">{a.prompt}</p>
            <Answer a={a} />
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Every other stored version of a response (another device's, or a draft typed after it),
 * each under a plain line saying what it is, so nothing she wrote is ever out of reach.
 */
export function OtherVersions({ others }: { others: ResponseVersion[] }) {
  if (others.length === 0) return null;
  return (
    <>
      {others.map((o, i) => (
        <div key={i}>
          <p className="journal-muted">{`${o.submitted ? ALSO_SUBMITTED : UNSENT_DRAFT} · ${when(o.at)}`}</p>
          <ResponseView text={o.text} parts={o.parts} />
        </div>
      ))}
    </>
  );
}

const when = (at: number) => {
  const d = new Date(at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${longDate(day)}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

const has = (v: unknown): boolean => (Array.isArray(v) ? v.some(has) : typeof v === "string" && v.trim() !== "");
const cell = (x: string) => (x.trim() ? x : <span className="journal-muted">{NOT_ANSWERED}</span>);

function Answer({ a }: { a: PartAnswer }) {
  const none = <p className="journal-muted">{NOT_ANSWERED}</p>;
  if (a.kind === "checklist" && Array.isArray(a.answer)) {
    // [item, choice, note] rows: each item with its choice and note.
    const rows = (a.answer as unknown[]).filter((r): r is string[] => Array.isArray(r));
    if (!rows.some((r) => has(r.slice(1)))) return none;
    return (
      <ul className="exercise-list-answer exercise-check-answers">
        {rows.map((r, i) => (
          <li key={i} className="exercise-check-answer">
            {r[0]}: {r[1]?.trim() ? r[1] : <span className="journal-muted">{NOT_ANSWERED}</span>}
            {r[2]?.trim() ? ` — ${r[2]}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(a.answer)) {
    if (!has(a.answer)) return none;
    const rows = a.answer as unknown[];
    if (rows.every((r) => Array.isArray(r))) {
      // A table's rows or a tracker's days, read back as lines.
      const grid = (rows as string[][]).map((r, i) => ({ r, i })).filter(({ r }) => r.some((x) => x.trim()));
      return (
        <ol className="exercise-list-answer">
          {grid.map(({ r, i }) => (
            <li key={i}>{a.kind === "tracker" ? `Day ${i + 1}: ${r.join(" · ")}` : r.join(" · ")}</li>
          ))}
        </ol>
      );
    }
    return (
      <ol className={a.kind === "chain" ? "exercise-list-answer exercise-chain-answer" : "exercise-list-answer"}>
        {(rows as string[]).map((x, i) => (
          <li key={i}>{cell(x)}</li>
        ))}
      </ol>
    );
  }
  if (typeof a.answer === "number") return <p className="journal-past-answer">{a.kind === "rating" ? `${a.answer} out of 10` : String(a.answer)}</p>;
  if (typeof a.answer === "string" && a.answer.trim()) return <p className="journal-past-answer">{a.answer}</p>;
  return none;
}

import type { PartAnswer } from "../../data/repo";

/** A part left empty, when reading back. */
export const NOT_ANSWERED = "Not answered";

/**
 * A response to an exercise card, read-only (Past exercises, All cards, Read back): the one
 * text, or each part's prompt and answer (a list as its numbered lines, a rating as "N out of
 * 10", a choice as the option chosen).
 */
export function ResponseView({ text, parts }: { text: string; parts: PartAnswer[] | null }) {
  if (!parts) return <p className="journal-past-answer">{text}</p>;
  return (
    <ol className="exercise-part-answers">
      {parts.map((a, i) => (
        <li key={i}>
          <p className="exercise-label">{a.prompt}</p>
          <Answer a={a} />
        </li>
      ))}
    </ol>
  );
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.some(has) : typeof v === "string" && v.trim() !== "");
const cell = (x: string) => (x.trim() ? x : <span className="journal-muted">{NOT_ANSWERED}</span>);

function Answer({ a }: { a: PartAnswer }) {
  const none = <p className="journal-muted">{NOT_ANSWERED}</p>;
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

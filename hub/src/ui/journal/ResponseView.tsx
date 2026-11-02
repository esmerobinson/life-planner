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

function Answer({ a }: { a: PartAnswer }) {
  const none = <p className="journal-muted">{NOT_ANSWERED}</p>;
  if (Array.isArray(a.answer)) {
    if (!a.answer.some((x) => x.trim())) return none;
    return (
      <ol className="exercise-list-answer">
        {a.answer.map((x, i) => (
          <li key={i}>{x.trim() ? x : <span className="journal-muted">{NOT_ANSWERED}</span>}</li>
        ))}
      </ol>
    );
  }
  if (typeof a.answer === "number") return <p className="journal-past-answer">{`${a.answer} out of 10`}</p>;
  if (typeof a.answer === "string" && a.answer.trim()) return <p className="journal-past-answer">{a.answer}</p>;
  return none;
}

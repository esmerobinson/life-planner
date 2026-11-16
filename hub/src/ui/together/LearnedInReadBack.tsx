import type { Learned } from "../../data/repo";
import { TOGETHER_WORDS as W } from "./wording";

/**
 * A day's "what I learned" words inside that day's Mental health exercise entry in Read back
 * (bug #45: everything she completes is easy to revisit). Plain, read-only; every version not
 * replaced is shown. PLACEHOLDER: placement and look go to the Design session.
 */
export function LearnedInReadBack({ day }: { day: Learned }) {
  const words = [day.text, ...day.others.map((o) => o.text)].filter((t) => t.trim() !== "");
  if (words.length === 0) return null;
  return (
    <div className="journal-readback-learned">
      <p className="exercise-label">{W.learnedReadBack}</p>
      {words.map((t, i) => (
        <p key={i} className="journal-past-answer">
          {t}
        </p>
      ))}
    </div>
  );
}

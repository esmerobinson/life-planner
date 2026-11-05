import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { listLearned, readLearned, saveLearned, type Learned } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import { MAX_LEARNED } from "../../journal/entries";
import type { JournalKey } from "../../journal/crypto";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { longDate } from "../journal/bits";
import { TOGETHER_WORDS as W } from "./wording";
import "./together.css";

/**
 * PLACEHOLDER look (Design pick A: always there under today's Mental health exercise, marked
 * optional): what she learned about BPD or mental health today. Saved sealed as she types (a
 * pause, leaving the box, hiding the app, closing the tab), shown again after a reload, and her
 * earlier days are listed under it. Goes to Together with that day's exercise, unless private.
 */
export function LearnedToday({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [day, setDay] = useState<Learned | null>(null);
  const [earlier, setEarlier] = useState<({ date: ISODate } & Learned)[]>([]);
  useEffect(() => {
    setDay(null);
    const sub = liveQuery(async () => ({ day: await readLearned(jk, today), earlier: await listLearned(jk, today) })).subscribe({
      next: (v) => {
        setDay(v.day);
        setEarlier(v.earlier);
      },
      error: () => undefined,
    });
    return () => sub.unsubscribe();
  }, [jk, today]);
  return (
    <section className="together-placeholder together-learned" aria-label={W.learnedSection}>
      {day === null ? null : <LearnedBox key={today} jk={jk} today={today} deviceId={deviceId} stored={day.text} />}
      {day && day.others.length > 0 && (
        <div>
          <p>{W.learnedOther}</p>
          {day.others.map((o, i) => (
            <p key={i} className="journal-past-answer">
              {o.text}
            </p>
          ))}
        </div>
      )}
      {earlier.length > 0 && (
        <details>
          <summary>{W.learnedEarlier}</summary>
          <ul>
            {earlier.map((d) => (
              <li key={d.date}>
                <p>{longDate(d.date)}</p>
                {[d.text, ...d.others.map((o) => o.text)].filter((t) => t.trim() !== "").map((t, i) => (
                  <p key={i} className="journal-past-answer">
                    {t}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function LearnedBox({ jk, today, deviceId, stored }: { jk: JournalKey; today: ISODate; deviceId: string; stored: string }) {
  const [problem, setProblem] = useState("");
  const draft = useDraft(
    stored,
    async (text) => {
      try {
        await saveLearned(jk, today, deviceId, text);
        setProblem("");
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    AUTOSAVE_MS,
  );
  return (
    <>
      <label className="form-field">
        <span className="form-label">{W.learnedLabel}</span>
        <textarea rows={3} maxLength={MAX_LEARNED} value={draft.value} onChange={(e) => draft.set(e.target.value)} onBlur={draft.flush} />
      </label>
      {problem && <p role="alert">{problem}</p>}
    </>
  );
}

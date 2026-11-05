import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";
import { listLearned, readLearned, removeLearnedVersion, saveLearned, type Learned, type LearnedVersion } from "../../data/repo";
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
      {day === null ? null : <LearnedBox key={today} jk={jk} today={today} deviceId={deviceId} day={day} />}
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

/**
 * The versions the box doesn't hold, read-only, each saying where it was written, with a way to
 * put its words into the box or (once confirmed) remove it: never cleared silently.
 */
function OtherVersions({
  versions, deviceId, onMerge, onRemove,
}: { versions: LearnedVersion[]; deviceId: string; onMerge: (v: LearnedVersion) => void; onRemove: (v: LearnedVersion) => Promise<void> }) {
  const [asking, setAsking] = useState<string | null>(null);
  if (versions.length === 0) return null;
  return (
    <>
      {versions.map((v) => (
        <div key={v.id} className="together-learned-other">
          <p>{v.device === deviceId ? W.learnedEarlierHere : W.learnedOtherDevice}</p>
          <p className="journal-past-answer">{v.text}</p>
          {asking === v.id ? (
            <div role="group" aria-label={W.learnedRemoveAsk}>
              <p>{W.learnedRemoveAsk}</p>
              <button type="button" onClick={() => void onRemove(v).then(() => setAsking(null))}>
                {W.learnedRemoveYes}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(null)}>
                {W.learnedRemoveNo}
              </button>
            </div>
          ) : (
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => onMerge(v)}>
                {W.learnedMerge}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(v.id)}>
                {W.learnedRemove}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The box. A session starts at the first word typed into a box with nothing unsaved: it writes
 * one new version (its own row, rewritten as she goes on typing) that replaces only the version
 * the box held when she started. Saves go one at a time.
 */
function LearnedBox({ jk, today, deviceId, day }: { jk: JournalKey; today: ISODate; deviceId: string; day: Learned }) {
  const [problem, setProblem] = useState("");
  const session = useRef<{ version?: string; seen: string[] } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const draft = useDraft(
    day.text,
    (text) => {
      const s = session.current ?? (session.current = { seen: [...day.seen] });
      const run = queue.current.then(async () => {
        try {
          s.version = await saveLearned(jk, today, deviceId, text, s);
          setProblem("");
        } catch (e) {
          setProblem(e instanceof Error ? e.message : String(e));
          throw e;
        }
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    AUTOSAVE_MS,
  );
  function begin() {
    // Nothing unsaved and the box holds a version this session didn't write: a new session,
    // replacing only that version.
    if (draft.value === day.text && (!session.current || session.current.version !== day.id)) {
      session.current = { seen: [...day.seen] };
    }
  }
  function change(text: string) {
    begin();
    draft.set(text);
  }
  /** Its words go into the box, after hers, and it is replaced by the box's version. */
  function merge(v: LearnedVersion) {
    begin();
    const s = session.current ?? (session.current = { seen: [...day.seen] });
    for (const t of v.seen) if (!s.seen.includes(t)) s.seen.push(t);
    const now = draft.value.trimEnd();
    draft.set(now ? `${now}\n\n${v.text}` : v.text);
    draft.flush();
  }
  async function remove(v: LearnedVersion) {
    try {
      await removeLearnedVersion(jk, today, deviceId, v.id);
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }
  const fromOther = day.id !== "" && day.device !== deviceId && day.text.trim() !== "";
  return (
    <>
    <div className="together-learned-box">
      <label className="form-field">
        <span className="form-label">{W.learnedLabel}</span>
        <textarea rows={3} maxLength={MAX_LEARNED} value={draft.value} onChange={(e) => change(e.target.value)} onBlur={draft.flush} />
      </label>
      {fromOther && <p>{W.learnedOther}</p>}
      {problem && <p role="alert">{problem}</p>}
    </div>
    <OtherVersions versions={day.others} deviceId={deviceId} onMerge={merge} onRemove={remove} />
    </>
  );
}

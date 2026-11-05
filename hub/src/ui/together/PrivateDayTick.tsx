import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { db } from "../../data/db";
import { readSharePrivate, saveSharePrivate, shareId, type SharePart } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { syncController, useSyncState } from "../../sync";
import type { SyncController } from "../../sync/controller";
import { TOGETHER_WORDS as W } from "./wording";
import "./together.css";

/**
 * PLACEHOLDER look (Design pick A: a tick under the answers): one day's "Keep my answers private"
 * tick for the exercise or the check-in, stored sealed in the journal, with what Oliver still
 * sees and the plain warning beside it. Saving it syncs at once, so another device that sends
 * learns of it as soon as it can (review C1); until it has gone, it says so.
 */
export function PrivateDayTick({
  jk, date, part, label = W.privateTick, controller = syncController,
}: { jk: JournalKey; date: ISODate; part: SharePart; label?: string; controller?: SyncController }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState("");
  const sync = useSyncState(controller);
  useEffect(() => {
    setOn(null);
    const sub = liveQuery(async () => ({
      on: (await readSharePrivate(jk, date))[part],
      waiting: !!(await db.pending.get(["journal", shareId(date, part)])),
    })).subscribe({
      next: (v) => {
        setOn(v.on);
        setWaiting(v.waiting);
      },
      error: () => setOn(null),
    });
    return () => sub.unsubscribe();
  }, [jk, date, part]);
  async function change(next: boolean) {
    setProblem("");
    try {
      await saveSharePrivate(jk, date, part, next);
      void controller.syncNow();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="together-placeholder together-private-tick">
      <label>
        <input type="checkbox" checked={on === true} disabled={on === null} onChange={(e) => void change(e.target.checked)} /> {label}
      </label>
      <p>{part === "exercise" ? W.oliverSeesExercise : W.oliverSeesCheckin}</p>
      <p className="together-warning">{W.privateWarning}</p>
      {waiting && sync.syncOn && <p role="status">{W.notSyncedYet}</p>}
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}

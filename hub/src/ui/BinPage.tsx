import { useContext, useEffect, useRef, useState } from "react";
import { emptyBin, listBin, listGoalBin, restoreFromBin, restoreGoalFromBin } from "../data/repo";
import type { Goal, ISODate, Item } from "../domain/types";
import { DATA_ERROR, useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

type Binned = { what: "item"; row: Item } | { what: "goal"; row: Goal };

/** Items and goals together, newest deletion first. */
function merge(items: Item[], goals: Goal[]): Binned[] {
  const all: Binned[] = [
    ...items.map((row) => ({ what: "item" as const, row })),
    ...goals.map((row) => ({ what: "goal" as const, row })),
  ];
  return all.sort(
    (a, b) =>
      (b.row.deletedAt ?? "").localeCompare(a.row.deletedAt ?? "") || (b.row.updatedAt ?? 0) - (a.row.updatedAt ?? 0),
  );
}

/**
 * The Bin: deleted items and goals, newest first, each with Restore; "Empty bin" (after a
 * confirmation) turns them into content-free tombstones that sync, and are shown nowhere.
 */
export function BinPage({ today }: { today: ISODate }) {
  // The open items change whenever anything is written (here, in another tab, or by sync).
  const { items, goals, refresh } = useHubData(today);
  const shell = useContext(ShellContext);
  const [bin, setBin] = useState<Binned[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState(false);
  /** The rows the confirmation names (snapshot when it opens): only these are emptied. */
  const [asking, setAsking] = useState<{ items: string[]; goals: string[] } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { attempt, saveError } = useSaveError();
  const busy = useRef(false);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([listBin(), listGoalBin()]).then(
      ([items, goals]) => {
        if (!live) return;
        setBin(merge(items, goals));
        setReadError(false);
        setLoaded(true);
      },
      () => live && setReadError(true),
    );
    return () => {
      live = false;
    };
  }, [items, goals, reads]);

  async function write(fn: () => Promise<unknown>) {
    if (busy.current) return false;
    busy.current = true;
    try {
      const ok = await attempt(fn);
      if (ok) {
        setReads((r) => r + 1);
        await refresh();
        await shell?.refresh();
      }
      return ok;
    } finally {
      busy.current = false;
    }
  }

  const n = bin.length;
  const askedN = asking ? asking.items.length + asking.goals.length : 0;
  // The question replaces the focused Empty bin button: focus lands on Cancel, so it is heard.
  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);
  return (
    <section className="bin-page">
      <h1>Bin</h1>
      {readError && <p>{DATA_ERROR}</p>}
      {saveError && <p className="form-message">{saveError}</p>}
      {loaded && n === 0 && <p>The bin is empty.</p>}
      {n > 0 && !asking && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setAsking({
              items: bin.filter((b) => b.what === "item").map((b) => b.row.id),
              goals: bin.filter((b) => b.what === "goal").map((b) => b.row.id),
            })
          }
        >
          Empty bin
        </button>
      )}
      {n > 0 && asking && (
        <div className="btn-group">
          <p id="bin-question">{`Delete ${askedN} ${askedN === 1 ? "item" : "items"} for good? This can't be undone.`}</p>
          <button
            type="button"
            onClick={() =>
              void write(() => emptyBin(today, asking)).then((ok) => {
                if (ok) setAsking(null);
              })
            }
          >
            Confirm
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary"
            aria-describedby="bin-question"
            onClick={() => setAsking(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {n > 0 && (
        <ul aria-label="In the bin" className="strip-list">
          {bin.map(({ what, row: it }) => (
            <li key={`${what}:${it.id}`} className="strip no-tick">
              <div className="strip-body">
                <div className="strip-title">{it.title}</div>
                {what === "goal" && (
                  <div className="strip-meta">
                    <span className="chip">Goal</span>
                  </div>
                )}
              </div>
              <div className="strip-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Restore: ${it.title}`}
                  onClick={() =>
                    void write(() => (what === "goal" ? restoreGoalFromBin(it.id, today) : restoreFromBin(it.id, today)))
                  }
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

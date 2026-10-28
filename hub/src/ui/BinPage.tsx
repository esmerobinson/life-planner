import { useContext, useEffect, useRef, useState } from "react";
import { emptyBin, listBin, restoreFromBin } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { DATA_ERROR, useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

/**
 * The Bin: deleted items, newest first, each with Restore; "Empty bin" (after a
 * confirmation) turns them into content-free tombstones that sync, and are shown nowhere.
 */
export function BinPage({ today }: { today: ISODate }) {
  // The open items change whenever anything is written (here, in another tab, or by sync).
  const { items, refresh } = useHubData(today);
  const shell = useContext(ShellContext);
  const [bin, setBin] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState(false);
  const [asking, setAsking] = useState(false);
  const { attempt, saveError } = useSaveError();
  const busy = useRef(false);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    listBin().then(
      (b) => {
        if (!live) return;
        setBin(b);
        setReadError(false);
        setLoaded(true);
      },
      () => live && setReadError(true),
    );
    return () => {
      live = false;
    };
  }, [items, reads]);

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
  return (
    <section className="bin-page">
      <h1>Bin</h1>
      {readError && <p>{DATA_ERROR}</p>}
      {saveError && <p className="form-message">{saveError}</p>}
      {loaded && n === 0 && <p>The bin is empty.</p>}
      {n > 0 && !asking && (
        <button type="button" className="btn-secondary" onClick={() => setAsking(true)}>
          Empty bin
        </button>
      )}
      {n > 0 && asking && (
        <div className="btn-group">
          <p>{`Delete ${n} ${n === 1 ? "item" : "items"} for good? This can't be undone.`}</p>
          <button
            type="button"
            onClick={() =>
              void write(() => emptyBin(today)).then((ok) => {
                if (ok) setAsking(false);
              })
            }
          >
            Confirm
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      )}
      {n > 0 && (
        <ul aria-label="In the bin" className="strip-list">
          {bin.map((it) => (
            <li key={it.id} className="strip no-tick">
              <div className="strip-body">
                <div className="strip-title">{it.title}</div>
              </div>
              <div className="strip-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Restore: ${it.title}`}
                  onClick={() => void write(() => restoreFromBin(it.id, today))}
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

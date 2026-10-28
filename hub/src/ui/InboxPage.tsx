import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createItem, deleteItem, getItem, listItems, putItemBack, restoreItem } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { UndoLine } from "./DeleteButton";
import { InboxRow } from "./InboxRow";
import { INBOX_SOURCES, inboxOrder, inboxSource, type InboxSource } from "./inboxSource";
import { NeedsALook } from "./NeedsALook";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

export function InboxPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  // The same order as Sort one by one (oldest first).
  const inbox = inboxOrder(items.filter((i) => i.areaId === "inbox" && i.status === "open"));

  const sourcesPresent = INBOX_SOURCES.filter((s) => inbox.some((i) => inboxSource(i) === s));
  const [from, setFrom] = useState<InboxSource | "All">("All");
  // The filter only exists when there is more than one source; a source that emptied falls back to All.
  const showFilter = sourcesPresent.length > 1;
  const effectiveFrom = showFilter && from !== "All" && sourcesPresent.includes(from) ? from : "All";
  // Reset (not just hide) a filter whose source has emptied, so it does not return when items do.
  const stale = from !== "All" && loaded && !sourcesPresent.includes(from);
  useEffect(() => {
    if (stale) setFrom("All");
  }, [stale]);
  const shown = effectiveFrom === "All" ? inbox : inbox.filter((i) => inboxSource(i) === effectiveFrom);

  const { attempt, saveError } = useSaveError();
  const [archived, setArchived] = useState<Item[]>([]);
  const [last, setLast] = useState<{ message: string; undo?: () => void } | null>(null);
  const deleting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const captureBox = useRef<HTMLInputElement>(null);
  const captureChain = useRef<Promise<void>>(Promise.resolve());

  // Archived inbox items are not in useHubData; re-read whenever the open items change.
  useEffect(() => {
    let live = true;
    listItems({ status: "archived", areaId: "inbox" }).then(
      (a) => live && setArchived(a),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [items]);

  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  /** Delete from a strip: to the Bin, with an Undo line. */
  async function remove(item: Item) {
    if (deleting.current) return;
    deleting.current = true;
    setBusy(true);
    try {
      const before: { row?: Item } = {};
      const ok = await attempt(async () => {
        before.row = await getItem(item.id);
        await deleteItem(item.id, today);
      });
      if (!ok) return;
      const was = before.row;
      setLast({
        message: "Moved to the Bin",
        undo: was
          ? () =>
              void attempt(() => putItemBack(was, today)).then(async (back) => {
                if (!back) return;
                setLast(null);
                await changed();
              })
          : undefined,
      });
      await changed();
    } finally {
      deleting.current = false;
      setBusy(false);
    }
  }

  /** Quick capture. The box is cleared at once so rapid entries never wait on a write; writes run in order. */
  function capture() {
    const title = draftRef.current.trim();
    if (!title) return;
    draftRef.current = "";
    setDraft("");
    captureBox.current?.focus();
    captureChain.current = captureChain.current.then(async () => {
      const ok = await attempt(() => createItem({ kind: "task", title, areaId: "inbox", priority: 2 }, today));
      if (!ok) {
        // Give the thought back so it is not lost.
        if (!draftRef.current) {
          draftRef.current = title;
          setDraft(title);
        }
        return;
      }
      await changed();
    });
  }

  if (error) {
    return (
      <section className="inbox-page">
        <h1>Inbox</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="inbox-page">
      <h1>Inbox</h1>
      {inbox.length > 0 && (
        <div className="btn-group inbox-sort">
          <span>{`${inbox.length} to sort`}</span>
          <Link to="/inbox/sort" className="btn-secondary">
            Sort one by one
          </Link>
        </div>
      )}
      <form
        className="inbox-capture form-row"
        onSubmit={(e) => {
          e.preventDefault();
          capture();
        }}
      >
        <label className="form-field">
          <span className="form-label">Add to inbox</span>
          <input
            ref={captureBox}
            type="text"
            aria-label="Add to inbox"
            value={draft}
            onChange={(e) => {
              draftRef.current = e.target.value;
              setDraft(e.target.value);
            }}
          />
        </label>
        <button type="submit" className="btn-secondary" aria-label="Add this to the inbox">
          Add
        </button>
      </form>
      {saveError && <p className="form-message">{saveError}</p>}
      <h2>To sort</h2>
      {loaded && inbox.length === 0 && <p>Nothing waiting in the inbox.</p>}
      {showFilter && (
        <div className="btn-group" role="group" aria-label="From">
          {(["All", ...sourcesPresent] as const).map((s) => (
            <button key={s} type="button" aria-pressed={effectiveFrom === s} onClick={() => setFrom(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <UndoLine message={last?.message} onUndo={last?.undo} takeFocus />
      {shown.length > 0 && (
        <ul aria-label="Inbox items" className="strip-list">
          {shown.map((it) => (
            <InboxRow key={it.id} item={it} today={today} goals={goals} onFiled={changed} onDelete={() => void remove(it)} busy={busy} />
          ))}
        </ul>
      )}
      <h2>Needs a look</h2>
      {loaded && <NeedsALook items={items} today={today} onChanged={changed} />}
      {archived.length > 0 && (
        <details>
          <summary>{`Archived from the inbox (${archived.length})`}</summary>
          <ul aria-label="Archived from the inbox" className="strip-list">
            {archived.map((it) => (
              <li key={it.id} className="strip no-tick">
                <div className="strip-body">
                  <div className="strip-title">{it.title}</div>
                </div>
                <div className="strip-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Restore: ${it.title}`}
                    onClick={() =>
                      void attempt(() => restoreItem(it.id, today)).then(async (ok) => {
                        if (ok) await changed();
                      })
                    }
                  >
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

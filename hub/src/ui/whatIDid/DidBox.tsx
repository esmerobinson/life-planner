import { useState } from "react";
import { saveDid } from "../../data/didRepo";
import { clearDidDraft, forgetDidDraft, keepDidDraft } from "../../data/didDraft";
import { isProject } from "../../domain/projects";
import type { DidEntry, DidFile, ISODate, Item } from "../../domain/types";
import { MAX_DID_NOTE } from "../../domain/whatIDid";
import { attachFiles, hasFileBridge, loadFilesRoot, revealFile } from "../../native/files";
import { AREA_CHOICES } from "../areas";
import { useSaveError } from "../messages";
import { AutoGrowTextarea } from "../useAutoGrow";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { DID_WORDS as W } from "./words";

/** Remembered on this device once a file was kept (the "first time" line then goes). */
const ATTACHED_ONCE_KEY = "esmeworld-did-attached";
const attachedOnce = () => {
  try {
    return localStorage.getItem(ATTACHED_ONCE_KEY) === "1";
  } catch {
    return false;
  }
};

export const areaName = (id: string) => AREA_CHOICES.find((a) => a.id === id)?.label ?? id;

/**
 * One "What I did" note being written: the box (saved as she types, after a pause, on leaving it,
 * on closing, on hiding the app and before the Mac's update; every key is also kept on this device
 * at once, data/didDraft.ts), the files kept with it, and Attach files on the Mac (elsewhere:
 * "Attach files on your Mac"). `item` is the to-do as stored now; `at` the note it writes.
 */
export function DidBox({
  item, at, today, label, labelHidden = false, autoFocus = false, onSaved, onEnter,
}: {
  item: Item;
  at: Pick<DidEntry, "id" | "on" | "session">;
  today: ISODate;
  /** The box's name (visible in the side panel; the sheet's heading names it there). */
  label: string;
  /** The box's name for screen readers only (the sheet's heading says it). */
  labelHidden?: boolean;
  autoFocus?: boolean;
  onSaved: () => void | Promise<void>;
  /** ⌘/Ctrl + Return in the box (the sheet: Save). */
  onEnter?: () => void;
}) {
  const { attempt, saveError } = useSaveError();
  const entry = item.did?.find((e) => e.id === at.id);
  const note = useDraft(
    entry?.note ?? "",
    async (text) => {
      if (!(await attempt(() => saveDid(item.id, at, { note: text }, today)))) throw new Error("not saved");
      clearDidDraft(item.id, at.id, text);
      await onSaved();
    },
    AUTOSAVE_MS,
  );
  const files = entry?.files ?? [];
  const mac = hasFileBridge();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [firstTime] = useState(() => !attachedOnce());

  async function attach() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    note.flush(); // the words first, so they are never behind the files
    try {
      const root = await loadFilesRoot();
      const r = await attachFiles({ root, area: areaName(item.areaId), ...(isProject(item) ? { project: item.title } : {}) });
      if (r.kind === "permission") setMessage(W.permission);
      else if (r.kind === "error") setMessage(W.attachFailed);
      else if (r.kind === "saved") {
        if (r.files.length) {
          if (!(await attempt(() => saveDid(item.id, at, { addFiles: r.files }, today)))) return;
          try {
            localStorage.setItem(ATTACHED_ONCE_KEY, "1");
          } catch {
            // Blocked storage: the line just stays.
          }
          await onSaved();
        }
        if (r.failed) setMessage(W.someFailed(r.failed));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="did-box">
      <label className="form-field">
        <span className={labelHidden ? "visually-hidden" : "form-label"}>{label}</span>
        <AutoGrowTextarea
          rows={3}
          maxLength={MAX_DID_NOTE}
          autoFocus={autoFocus}
          value={note.value}
          onChange={(e) => {
            const text = e.target.value;
            // Back to what is saved (typed and deleted): nothing to keep (review C1).
            if (text === (entry?.note ?? "")) forgetDidDraft(item.id, at.id);
            else keepDidDraft({ itemId: item.id, at, text, typedAt: Date.now() });
            note.set(text);
          }}
          onBlur={note.flush}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      </label>
      {saveError && <p className="form-message">{saveError}</p>}
      {files.length > 0 && <FileList files={files} mac={mac} />}
      {mac ? (
        <div className="did-attach">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void attach()}>
            {busy ? W.attaching : W.attach}
          </button>
          {firstTime && files.length === 0 && <p className="choose-muted">{W.firstTime}</p>}
        </div>
      ) : (
        <p className="choose-muted">{W.attachOnMac}</p>
      )}
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}

/** The kept files' names; on the Mac each one shows itself in Finder. */
export function FileList({ files, mac = hasFileBridge() }: { files: readonly DidFile[]; mac?: boolean }) {
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <>
      <ul className="did-files" aria-label={W.files}>
        {files.map((f, i) => (
          <li key={`${f.folder}/${f.name}:${i}`}>
            {mac ? (
              <button
                type="button"
                className="quiet-link"
                title={`${W.revealHint}: ${f.folder}`}
                onClick={async () => setMissing((await revealFile(f)) === "missing" ? `${f.folder}/${f.name}` : null)}
              >
                {f.name}
              </button>
            ) : (
              <span title={f.folder}>{f.name}</span>
            )}
          </li>
        ))}
      </ul>
      {missing && <p className="form-message" role="status">{W.missing}</p>}
    </>
  );
}

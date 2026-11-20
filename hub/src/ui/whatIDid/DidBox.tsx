import { useRef, useState, type ReactNode } from "react";
import { saveDid } from "../../data/didRepo";
import { clearDidDraft, forgetDidDraft, keepDidDraft } from "../../data/didDraft";
import { isProject } from "../../domain/projects";
import type { DidEntry, DidFile, ISODate, Item } from "../../domain/types";
import { MAX_DID_NOTE, MAX_DID_PHOTOS, photosOf } from "../../domain/whatIDid";
import { attachFiles, hasFileBridge, loadFilesRoot, MAX_PHOTO_COPY_BYTES, revealFile, savePhotoCopy } from "../../native/files";
import { AREA_CHOICES } from "../areas";
import { useSaveError } from "../messages";
import { blobToBase64 } from "../picture";
import { storePhotos } from "../storePhotos";
import { AutoGrowTextarea } from "../useAutoGrow";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { PhotoStrip } from "./DidPhotos";
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
 * "Attach files on your Mac"). Add photo everywhere (19 Nov 2026): the photo goes in the synced
 * files table like a page's (ui/storePhotos.ts), and on the Mac a copy also goes into the area's
 * folder like an attached file. `item` is the to-do as stored now; `at` the note it writes.
 */
export function DidBox({
  item, at, today, label, labelHidden = false, autoFocus = false, onSaved, onEnter, actions, compact = false, onTyped,
  enlarge = true,
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
  /** Buttons put in the same row as Attach files (the sheet's Save and Skip). */
  actions?: ReactNode;
  /** The phone's card (review I3): a one-line box that grows as she types, its name as its hint. */
  compact?: boolean;
  /** She typed something. */
  onTyped?: () => void;
  /** Its photos open larger when tapped (not in the card after a tick: a tap outside closes it). */
  enlarge?: boolean;
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
  const photos = photosOf(item, at.id);
  const [adding, setAdding] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  /** Stores the chosen photos on the note; on the Mac, also copies each into the area's folder. */
  async function addPhotos(picked: File[]) {
    if (!picked.length) return;
    setAdding(true);
    setMessage(null);
    note.flush(); // the words first, so they are never behind the photos
    try {
      // Only as many as the note has room for; the rest are never stored, and she is told (M1).
      const room = Math.max(0, MAX_DID_PHOTOS - photos.length);
      const chosen = picked.slice(0, room);
      const over = picked.length - chosen.length;
      const { ids, stored, message: why } = chosen.length ? await storePhotos(chosen, today) : { ids: [], stored: [], message: null };
      const limit = over > 0 ? W.photoLimit(MAX_DID_PHOTOS, over) : null;
      if (why || limit) setMessage([why, limit].filter(Boolean).join(" "));
      if (!ids.length) return;
      if (!(await attempt(() => saveDid(item.id, at, { addPhotos: ids }, today)))) return;
      await onSaved();
      if (!mac) return;
      const root = await loadFilesRoot();
      const kept: DidFile[] = [];
      for (const f of stored) {
        if (f.size > MAX_PHOTO_COPY_BYTES) {
          setMessage(W.photoNotCopied);
          continue;
        }
        const r = await savePhotoCopy({
          root, area: areaName(item.areaId), ...(isProject(item) ? { project: item.title } : {}),
          name: f.name, type: f.type, data: await blobToBase64(f),
        });
        if (r.kind === "saved") kept.push(...r.files);
        else if (r.kind === "permission") setMessage(W.photoPermission);
        else if (r.kind !== "unavailable") setMessage(W.photoNotCopied); // an older Mac app can't: no copy, no fuss (M8)
      }
      if (kept.length && (await attempt(() => saveDid(item.id, at, { addFiles: kept }, today)))) await onSaved();
    } finally {
      setAdding(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function removePhoto(id: string) {
    if (await attempt(() => saveDid(item.id, at, { removePhoto: id }, today))) await onSaved();
  }

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
          rows={compact ? 1 : 3}
          placeholder={compact ? label : undefined}
          maxLength={MAX_DID_NOTE}
          autoFocus={autoFocus}
          value={note.value}
          onChange={(e) => {
            const text = e.target.value;
            onTyped?.();
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
      <PhotoStrip ids={photos} enlarge={enlarge} onRemove={(id) => void removePhoto(id)} />
      {files.length > 0 && <FileList files={files} mac={mac} />}
      <div className="did-attach">
        {actions}
        {/* Placement provisional (for Esme / Design): with Save, Skip and Attach files. */}
        <button type="button" className="btn-secondary" disabled={adding} onClick={() => photoInput.current?.click()}>
          {adding ? W.addingPhoto : W.addPhoto}
        </button>
        <input
          ref={photoInput}
          type="file"
          // image/* and no `capture`: the iPhone offers Take Photo or Photo Library.
          accept="image/*"
          multiple
          className="page-file"
          aria-label={W.choosePhoto}
          tabIndex={-1}
          onChange={(e) => void addPhotos(Array.from(e.target.files ?? []))}
        />
        {mac ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void attach()}>
            {busy ? W.attaching : W.attach}
          </button>
        ) : (
          <span className="choose-muted">{W.attachOnMac}</span>
        )}
      </div>
      {mac && firstTime && files.length === 0 && <p className="choose-muted">{W.firstTime}</p>}
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

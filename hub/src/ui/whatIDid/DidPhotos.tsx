import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFile } from "../useFile";
import { DID_WORDS as W } from "./words";

/**
 * A "What I did" note's photos as thumbnails (Esme, 19 Nov 2026): in the card after a tick, in
 * the side panel and on the log page. Tapped, one shows larger (not in the card after a tick: a
 * tap outside the card closes it). With `onRemove`, each has Remove. New and undecided, so the
 * look is the magenta placeholder (whatIDid.css), for Esme / Design.
 */
export function PhotoStrip({
  ids, enlarge = true, onRemove,
}: {
  ids: readonly string[];
  /** Tap one to see it larger. */
  enlarge?: boolean;
  onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (ids.length === 0) return null;
  return (
    <>
      <ul className="did-photos" aria-label={W.photos}>
        {ids.map((id, i) => (
          <li key={id} className="did-photo">
            {enlarge ? (
              <button
                type="button"
                className="did-photo-open"
                aria-label={W.showPhoto(i + 1)}
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setOpen(id);
                }}
              >
                <Thumb id={id} alt="" />
              </button>
            ) : (
              <Thumb id={id} alt={W.photo(i + 1)} />
            )}
            {onRemove && (
              <button type="button" className="quiet-link" aria-label={W.removePhoto(i + 1)} onClick={() => onRemove(id)}>
                {W.remove}
              </button>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <PhotoViewer
          id={open}
          onClose={() => {
            setOpen(null);
            if (opener.current?.isConnected) opener.current.focus();
          }}
        />
      )}
    </>
  );
}

/** One photo, small; a quiet box until its file row has arrived (or when it was emptied). */
function Thumb({ id, alt }: { id: string; alt: string }) {
  const file = useFile(id);
  if (file && file.status !== "purged" && file.data !== "") {
    return <img className="did-photo-img" src={`data:${file.mime};base64,${file.data}`} alt={alt} width={file.width} height={file.height} />;
  }
  if (file === undefined) return <span className="did-photo-wait" aria-hidden="true" />;
  const why = file ? W.photoGone : W.photoWaiting;
  return (
    <span className="did-photo-wait" role="img" aria-label={why}>
      {why}
    </span>
  );
}

/** One photo, larger, over the page. Escape, Close or a tap beside it closes it (and only it). */
function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const file = useFile(id);
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // First, so the side panel under it stays open.
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const shown = file && file.status !== "purged" && file.data !== "";
  return createPortal(
    <div
      className="did-photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={W.photoViewer}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {shown ? (
        <img src={`data:${file.mime};base64,${file.data}`} alt={W.photoViewer} width={file.width} height={file.height} />
      ) : (
        <span className="did-photo-wait">{file ? W.photoGone : W.photoWaiting}</span>
      )}
      <button ref={close} type="button" className="btn-secondary" onClick={onClose}>
        {W.close}
      </button>
    </div>,
    document.body,
  );
}

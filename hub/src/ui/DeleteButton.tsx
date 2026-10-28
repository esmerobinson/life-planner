/* A simple line-drawn bin in the round-2 1B icon style: 16px, 1.6 stroke, currentColor.
   The drawing is the implementer's (the brief asked for "a simple line bin"). */
export const BIN_GLYPH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <path d="M2 4h12M6 4V2h4v2M3.5 4l.8 10h7.4l.8-10M6.5 7v4.5M9.5 7v4.5" />
  </svg>
);

/** The Delete icon (30px, like Schedule for and Move to): moves the item to the Bin. */
export function DeleteButton({ label, onDelete, disabled }: { label: string; onDelete: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="icon" aria-label={`Delete: ${label}`} title="Delete" disabled={disabled} onClick={onDelete}>
      {BIN_GLYPH}
    </button>
  );
}

/**
 * The line after an action: "Filed as To-do in Writing · Undo" (Undo only when it can be
 * undone). Always rendered (empty until something happens) so screen readers hear it.
 */
export function UndoLine({ message, onUndo }: { message?: string; onUndo?: () => void }) {
  return (
    <p className="undo-line" role="status">
      {message}
      {message && onUndo && (
        <>
          {" · "}
          <button type="button" className="link-button" onClick={onUndo}>
            Undo
          </button>
        </>
      )}
    </p>
  );
}

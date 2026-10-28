import { usePanel } from "./panelContext";

/**
 * The panel's top row: on a phone the round back arrow on the left (it closes the panel);
 * on the right Edit (or Done and Cancel while editing) and, on a computer, Close.
 */
export function PanelTop({
  phone,
  kicker,
  editing,
  onEdit,
  onDone,
  onCancel,
  busy,
}: {
  phone: boolean;
  /** A small word before the buttons (the goal mockup's "Goal"). */
  kicker?: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const panel = usePanel();
  return (
    <div className="peek-top">
      {phone && (
        <button type="button" className="phone-back" aria-label="Back" onClick={() => panel?.close()}>
          ←
        </button>
      )}
      {kicker && <span className="peek-kicker">{kicker}</span>}
      <span className="peek-top-actions">
        {editing ? (
          <>
            <button type="button" className="peek-pill" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="peek-pill is-done" onClick={onDone} disabled={busy}>
              Done
            </button>
          </>
        ) : (
          <button type="button" className="peek-pill" onClick={onEdit}>
            Edit
          </button>
        )}
        {!phone && (
          <button type="button" className="peek-pill" onClick={() => panel?.close()}>
            Close
          </button>
        )}
      </span>
    </div>
  );
}

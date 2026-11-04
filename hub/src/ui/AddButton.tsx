import { useEffect, useRef, type ReactNode } from "react";
import { usePanel } from "./panelContext";

/**
 * Add as a round "+" button fixed bottom right on every page (mockup add-and-projects.html
 * option 1C). The form opens as a card just above it on a computer, or as a sheet from the
 * bottom on a phone (with a shade over the page and Close). Nothing animates: it just
 * appears. Escape, a click outside, the button again (or Close / Cancel) closes it, and
 * focus goes back to the button.
 *
 * `children(close)` is the form; call `close()` when it is done with.
 */
export function AddButton({
  open,
  onToggle,
  phone,
  buttonRef,
  children,
}: {
  open: boolean;
  /** Opens (true) or closes (false). */
  onToggle: (open: boolean) => void;
  phone: boolean;
  buttonRef: React.RefObject<HTMLButtonElement>;
  children: (close: () => void) => ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  // The button sits under the side panel: while the panel is open it is left out, so it is
  // neither hidden-but-tabbable nor opening a card under the panel (review M-6).
  const panelOpen = Boolean(usePanel()?.openId);
  // A panel opened by keyboard while Add is open: Add closes (what was typed is kept, as for a click outside).
  useEffect(() => {
    if (panelOpen && open) onToggle(false);
  }, [panelOpen, open, onToggle]);

  function close() {
    onToggle(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    // Capture: Add is on top, so it hears Escape before the side panel does.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (card.current?.querySelector(".pop-menu")) return;
      e.preventDefault();
      onToggle(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || buttonRef.current?.contains(t)) return;
      onToggle(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onToggle, buttonRef]);

  const head = (
    <div className="add-head">
      <h2>Add</h2>
      {phone && (
        <button type="button" className="peek-pill" onClick={close}>
          Close
        </button>
      )}
    </div>
  );

  return (
    <>
      {open &&
        (phone ? (
          <div className="add-shade">
            <div ref={card} className="add-sheet" role="dialog" aria-modal="true" aria-label="Add">
              {head}
              {children(close)}
            </div>
          </div>
        ) : (
          <div ref={card} className="add-pop" role="dialog" aria-label="Add">
            {head}
            {children(close)}
          </div>
        ))}
      {!panelOpen && (
      <button
        ref={buttonRef}
        type="button"
        className="add-fab"
        aria-label="Add"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        {/* Drawn, not a font glyph: a "+" or "×" character sits off-centre in most fonts. */}
        <svg className="add-fab-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <g transform={open && !phone ? "rotate(45 10 10)" : undefined}>
            <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </g>
        </svg>
      </button>
      )}
    </>
  );
}

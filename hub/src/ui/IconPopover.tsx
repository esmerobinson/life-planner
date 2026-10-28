import { useEffect, useRef, useState, type ReactNode } from "react";

/* Glyphs copied from the round-2 mockup, option 1B: 16px, 1.6 stroke, currentColor. */
export const CALENDAR_GLYPH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <rect x="2" y="3" width="12" height="11" rx="2" />
    <path d="M2 7h12M5 1v4M11 1v4" />
  </svg>
);

export const ARROW_GLYPH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <path d="M2 8h11M9 4l4 4-4 4" />
  </svg>
);

/* Repeat symbol copied from the round-3 mockup (habits): 16px, 1.6 stroke, currentColor. */
export const REPEAT_GLYPH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <path d="M3 6a5 5 0 0 1 9-2M13 10a5 5 0 0 1-9 2" />
    <path d="M12 1v3h-3M4 15v-3h3" />
  </svg>
);

/* Milestone flag (round 3): drawn by the implementer in the calendar/arrow style (16px
   box, 1.6 stroke, currentColor); the drawing is unreviewed. */
export const FLAG_GLYPH = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
    <path d="M3.5 15V1.5" />
    <path d="M3.5 2.5h9l-2.2 3.2 2.2 3.3h-9" />
  </svg>
);

/**
 * A small icon button that opens a plain group of buttons under it (no menu roles: no
 * arrow-key machinery is promised). Escape closes it and returns focus to the icon; so
 * does a click anywhere outside it.
 */
export function IconPopover({
  icon,
  label,
  tooltip,
  groupLabel,
  message,
  children,
}: {
  icon: ReactNode;
  /** Accessible name of the icon button, e.g. "Move to: Buy stamps". */
  label: string;
  /** The `title` tooltip, e.g. "Move to". */
  tooltip: string;
  /** Accessible name of the open group, e.g. "Move Buy stamps to". */
  groupLabel: string;
  /** A save message shown beside the icon (outside the popover, so it outlives it). */
  message?: string | null;
  /** The popover's contents; call `close()` when a choice is made. */
  children: (close: (refocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  function close(refocus = false) {
    setOpen(false);
    if (refocus) toggle.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    // On the document, not the popover: Safari and Firefox on macOS leave focus on <body>
    // after a click on the icon, so a key handler on the popover would never hear Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="pop" ref={wrap}>
      <button
        ref={toggle}
        type="button"
        className="icon"
        aria-label={label}
        title={tooltip}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div role="group" aria-label={groupLabel} className="pop-menu">
          {children(close)}
        </div>
      )}
      {message && <span className="form-message">{message}</span>}
    </span>
  );
}

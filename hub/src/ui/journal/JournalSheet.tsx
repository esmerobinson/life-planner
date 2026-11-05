import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A Journal pop-up, the same pattern as Choose goals (ChooseGoalsSheet): a --panel sheet over
 * a dimmed page with its heading, a line under it and "Done" at the top right. Done, Escape or
 * a click on the dimmed page closes it; focus stays inside while it is open and goes back to
 * what opened it after. On a phone it is a full-screen sheet (goals.css `.is-phone`).
 */
export function JournalSheet({
  title, line, onClose, children, className,
}: { title: string; line?: ReactNode; onClose: () => void; children: ReactNode; className?: string }) {
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const headingId = useId();

  useEffect(() => {
    opener.current = document.activeElement;
    sheet.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !sheet.current) return;
    const all = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === sheet.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="choose-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className={className ? `choose-sheet ${className}` : "choose-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <div className="choose-top">
          <div>
            <h2 id={headingId}>{title}</h2>
            {line && <div className="choose-muted">{line}</div>}
          </div>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

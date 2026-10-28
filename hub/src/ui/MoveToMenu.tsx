import { useRef, useState } from "react";
import { archiveItem, moveTo, removeFromToday } from "../data/repo";
import type { ISODate } from "../domain/types";
import { useSaveError } from "./messages";

type Choice = "today" | "tomorrow" | "week" | "remove" | "archive";

const CHOICES: { id: Choice; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "remove", label: "Remove from today" },
  { id: "archive", label: "Archive" },
];

export function MoveToMenu({
  itemId,
  today,
  onMoved,
  label,
}: {
  itemId: string;
  today: ISODate;
  onMoved: () => void | Promise<void>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { attempt, saveError } = useSaveError();
  const toggle = useRef<HTMLButtonElement>(null);

  async function pick(c: Choice) {
    const ok = await attempt(async () => {
      if (c === "remove") await removeFromToday(itemId, today);
      else if (c === "archive") await archiveItem(itemId, today);
      else await moveTo(itemId, c, today);
    });
    setOpen(false);
    if (ok) await onMoved();
    else toggle.current?.focus(); // the clicked choice is gone; keep focus somewhere sensible
  }

  // A plain disclosure of buttons (no menu roles: no arrow-key machinery is promised).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    }
  }

  return (
    <span className="move-menu" onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="btn-secondary"
        aria-expanded={open}
        aria-label={label ? `Move: ${label}` : "Move to"}
        onClick={() => setOpen((o) => !o)}
      >
        Move to
      </button>
      {open && (
        <div role="group" aria-label={label ? `Move ${label} to` : "Move to"}>
          {CHOICES.map((c) => (
            <button key={c.id} type="button" onClick={() => void pick(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {saveError && <span className="form-message">{saveError}</span>}
    </span>
  );
}

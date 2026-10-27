import { useState } from "react";
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

  async function pick(c: Choice) {
    const ok = await attempt(async () => {
      if (c === "remove") await removeFromToday(itemId, today);
      else if (c === "archive") await archiveItem(itemId, today);
      else await moveTo(itemId, c, today);
    });
    setOpen(false);
    if (ok) await onMoved();
  }

  return (
    <span className="move-menu">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ? `Move: ${label}` : "Move to"}
        onClick={() => setOpen((o) => !o)}
      >
        Move to
      </button>
      {open && (
        <div role="menu">
          {CHOICES.map((c) => (
            <button key={c.id} type="button" role="menuitem" onClick={() => void pick(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {saveError && <span className="form-message">{saveError}</span>}
    </span>
  );
}

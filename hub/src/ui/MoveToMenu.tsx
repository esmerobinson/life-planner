import { archiveItem, itemToGoal, moveTo, removeFromToday, updateItem } from "../data/repo";
import type { AreaId, ISODate, Item } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { ARROW_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";

type Choice =
  | { kind: "become"; to: "task" | "idea" | "goal" }
  | { kind: "area"; areaId: AreaId }
  | { kind: "week" }
  | { kind: "remove" }
  | { kind: "archive" };

const TYPES: { to: "task" | "idea" | "goal"; label: string }[] = [
  { to: "task", label: "To-do" },
  { to: "idea", label: "Idea" },
  { to: "goal", label: "Goal" },
];

/**
 * The arrow icon (Move to). When the item's kind is known: "Change to" first (the types
 * it is not: To-do, Idea, Goal), then the other areas, then This week (not for ideas)
 * and Remove from today (only on the Today list), then Archive.
 */
export function MoveToMenu({
  itemId,
  areaId,
  kind,
  today,
  onMoved,
  label,
  onTodayList = false,
}: {
  itemId: string;
  areaId?: AreaId;
  kind?: Item["kind"];
  /** Offer "Remove from today" (only where the list is Today's). */
  onTodayList?: boolean;
  today: ISODate;
  onMoved: () => void | Promise<void>;
  label?: string;
}) {
  const { attempt, saveError } = useSaveError();

  async function pick(c: Choice, close: (refocus?: boolean) => void) {
    const ok = await attempt(async () => {
      if (c.kind === "become") {
        if (c.to === "goal") await itemToGoal(itemId, areaId ?? "admin", today);
        // An idea has no due date, repeat or day on Today; remove them explicitly (as the Inbox does).
        else if (c.to === "idea") {
          await updateItem(
            itemId,
            { kind: "idea", due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined },
            today,
          );
        } else await updateItem(itemId, { kind: "task" }, today);
      } else if (c.kind === "area") await updateItem(itemId, { areaId: c.areaId }, today);
      else if (c.kind === "week") await moveTo(itemId, "week", today);
      else if (c.kind === "remove") await removeFromToday(itemId, today);
      else await archiveItem(itemId, today);
    });
    close(!ok); // the clicked choice is gone; on failure keep focus somewhere sensible
    if (ok) await onMoved();
  }

  return (
    <IconPopover
      icon={ARROW_GLYPH}
      label={label ? `Move to: ${label}` : "Move to"}
      tooltip="Move to"
      groupLabel={label ? `Move ${label} to` : "Move to"}
      message={saveError}
    >
      {(close) => (
        <>
          {kind && (
            <>
              <div role="group" aria-label="Change to">
                <div className="pop-menu-label" aria-hidden="true">
                  Change to
                </div>
                {TYPES.filter((t) => t.to !== kind).map((t) => (
                  <button key={t.to} type="button" onClick={() => void pick({ kind: "become", to: t.to }, close)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <hr />
            </>
          )}
          {GOAL_AREAS_BY_SIDEBAR.filter((a) => a.id !== areaId).map((a) => (
            <button key={a.id} type="button" onClick={() => void pick({ kind: "area", areaId: a.id }, close)}>
              {a.label}
            </button>
          ))}
          {kind !== "idea" && (
            <>
              <hr />
              <button type="button" onClick={() => void pick({ kind: "week" }, close)}>
                This week
              </button>
              {onTodayList && (
                <button type="button" onClick={() => void pick({ kind: "remove" }, close)}>
                  Remove from today
                </button>
              )}
            </>
          )}
          <hr />
          <button type="button" onClick={() => void pick({ kind: "archive" }, close)}>
            Archive
          </button>
        </>
      )}
    </IconPopover>
  );
}

import { useNavigate } from "react-router-dom";
import { archiveItem, deleteItem, itemToGoal, moveTo, removeFromToday, setMilestone, updateItem } from "../data/repo";
import type { AreaId, ISODate, Item } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { ARROW_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";

type Choice =
  | { kind: "become"; to: "task" | "idea" | "goal" }
  | { kind: "area"; areaId: AreaId }
  | { kind: "milestone"; on: boolean }
  | { kind: "week" }
  | { kind: "remove" }
  | { kind: "archive" }
  | { kind: "delete" };

const TYPES: { to: "task" | "idea" | "goal"; label: string }[] = [
  { to: "task", label: "To-do" },
  { to: "idea", label: "Idea" },
  { to: "goal", label: "Goal" },
];

/**
 * The arrow icon (Move to). When the item's kind is known: "Change to" first (the types
 * it is not: To-do, Idea, Goal), then the other areas, then This week (not for ideas)
 * and Remove from today (only on the Today list), then Archive and Delete (to the Bin).
 * An unsorted Inbox item (`untyped`) has no type to change and no area to move between:
 * its menu is "Sort this…" (Sort one by one, opened on it), then Archive and Delete.
 */
export function MoveToMenu({
  itemId,
  areaId,
  kind,
  today,
  onMoved,
  label,
  onTodayList = false,
  untyped = false,
  milestone,
}: {
  /**
   * For a to-do with a goal: whether it is flagged as a milestone (offers "Mark as
   * milestone", or "Unmark as milestone" when it is). Undefined: no row.
   */
  milestone?: boolean;
  itemId: string;
  areaId?: AreaId;
  kind?: Item["kind"];
  /** Offer "Remove from today" (only where the list is Today's). */
  onTodayList?: boolean;
  today: ISODate;
  onMoved: () => void | Promise<void>;
  label?: string;
  /** An unsorted Inbox item: "Sort this…" instead of the types, areas and This week. */
  untyped?: boolean;
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
      else if (c.kind === "milestone") await setMilestone(itemId, c.on, today);
      else if (c.kind === "week") await moveTo(itemId, "week", today);
      else if (c.kind === "remove") await removeFromToday(itemId, today);
      else if (c.kind === "archive") await archiveItem(itemId, today);
      else await deleteItem(itemId, today);
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
          {untyped && (
            <>
              <SortThis itemId={itemId} close={close} />
              <hr />
            </>
          )}
          {!untyped && kind && (
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
          {!untyped && milestone !== undefined && (
            <>
              <button type="button" onClick={() => void pick({ kind: "milestone", on: !milestone }, close)}>
                {milestone ? "Unmark as milestone" : "Mark as milestone"}
              </button>
              <hr />
            </>
          )}
          {!untyped && GOAL_AREAS_BY_SIDEBAR.filter((a) => a.id !== areaId).map((a) => (
            <button key={a.id} type="button" onClick={() => void pick({ kind: "area", areaId: a.id }, close)}>
              {a.label}
            </button>
          ))}
          {!untyped && kind !== "idea" && (
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
          {!untyped && <hr />}
          <button type="button" onClick={() => void pick({ kind: "archive" }, close)}>
            Archive
          </button>
          <button type="button" onClick={() => void pick({ kind: "delete" }, close)}>
            Delete
          </button>
        </>
      )}
    </IconPopover>
  );
}

/** "Sort this…": Sort one by one, opened on this item (only on Inbox strips, which sit in a router). */
function SortThis({ itemId, close }: { itemId: string; close: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        close();
        navigate(`/inbox/sort?item=${encodeURIComponent(itemId)}`);
      }}
    >
      Sort this…
    </button>
  );
}

import { archiveItem, moveTo, removeFromToday, updateItem } from "../data/repo";
import type { AreaId, ISODate } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { ARROW_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";

type Choice = { kind: "area"; areaId: AreaId } | { kind: "week" } | { kind: "remove" } | { kind: "archive" };

/**
 * The arrow icon (Move to): the other areas first, then This week and Remove from today
 * (the old menu's choices that Schedule for does not cover), then Archive.
 */
export function MoveToMenu({
  itemId,
  areaId,
  today,
  onMoved,
  label,
}: {
  itemId: string;
  areaId?: AreaId;
  today: ISODate;
  onMoved: () => void | Promise<void>;
  label?: string;
}) {
  const { attempt, saveError } = useSaveError();

  async function pick(c: Choice, close: (refocus?: boolean) => void) {
    const ok = await attempt(async () => {
      if (c.kind === "area") await updateItem(itemId, { areaId: c.areaId }, today);
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
          {GOAL_AREAS_BY_SIDEBAR.filter((a) => a.id !== areaId).map((a) => (
            <button key={a.id} type="button" onClick={() => void pick({ kind: "area", areaId: a.id }, close)}>
              {a.label}
            </button>
          ))}
          <hr />
          <button type="button" onClick={() => void pick({ kind: "week" }, close)}>
            This week
          </button>
          <button type="button" onClick={() => void pick({ kind: "remove" }, close)}>
            Remove from today
          </button>
          <hr />
          <button type="button" onClick={() => void pick({ kind: "archive" }, close)}>
            Archive
          </button>
        </>
      )}
    </IconPopover>
  );
}

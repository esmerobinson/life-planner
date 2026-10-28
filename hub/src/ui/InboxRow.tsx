import type { ISODate, Item } from "../domain/types";
import { DeleteButton } from "./DeleteButton";
import { TaskRow } from "./TaskRow";

/** The reason line for an item that needs a decision: `check` tag plus a first notes line "Check: ...". */
function checkReason(item: Item): string | null {
  if (!item.tags?.includes("check")) return null;
  const first = (item.notes ?? "").split(/\r?\n/)[0].trim();
  return /^check:/i.test(first) ? first : null;
}

/**
 * One Inbox item as a strip. It has no type yet (sorting gives it one, in Sort one by
 * one): no tick box, no to-do or idea label. On the right: Schedule for, Move to ("Sort
 * this…", Archive, Delete) and Delete. Clicking the title opens it in the side panel,
 * where its goal, priority and due date are set (round 3 retired the temporary "More
 * options"); its type and area are still chosen only through Sort.
 */
export function InboxRow({
  item,
  today,
  onFiled,
  onDelete,
  busy,
}: {
  item: Item;
  today: ISODate;
  onFiled: () => void | Promise<void>;
  onDelete: () => void;
  busy?: boolean;
}) {
  const reason = checkReason(item);
  return (
    <TaskRow
      item={item}
      today={today}
      onMoved={onFiled}
      className="inbox-row"
      untyped
      meta={
        (item.tags?.length || reason) && (
          <div className="strip-meta">
            {item.tags?.map((t) => (
              <span key={t} className="inbox-tag">
                #{t}{" "}
              </span>
            ))}
            {reason && <p className="inbox-check">{reason}</p>}
          </div>
        )
      }
      trail={<DeleteButton label={item.title} onDelete={onDelete} disabled={busy} />}
    />
  );
}

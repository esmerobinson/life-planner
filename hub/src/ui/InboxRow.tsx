import type { ISODate, Item } from "../domain/types";
import { DeleteButton } from "./DeleteButton";
import { TaskRow } from "./TaskRow";

/**
 * One Inbox item as a strip. It has no type yet (sorting gives it one, in Sort one by
 * one): no tick box, no to-do or idea label. On the right: Schedule for, Move to ("Sort
 * this…", Archive, Delete) and Delete. Clicking the title opens it in the side panel,
 * where its goal, priority and due date are set (round 3 retired the temporary "More
 * options"); its type and area are still chosen only through Sort. Its tags and a
 * "Check: …" first notes line are behind the strip's "See more" (compact strips).
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
  return (
    <TaskRow
      item={item}
      today={today}
      onMoved={onFiled}
      className="inbox-row"
      untyped
      trail={<DeleteButton label={item.title} onDelete={onDelete} disabled={busy} />}
    />
  );
}

import { useCallback } from "react";
import { deleteItem, getItem, repeatAgain, stopRepeating } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { useSaveError } from "./messages";
import { useRowUndo } from "./undoSessions";

/**
 * Stop repeating, Repeat again and Delete for a repeating item, each with the shell's Undo
 * line (which puts the whole row back as it was). `onDone` re-reads whatever the caller shows.
 * `saveError` is the plain message when a write failed.
 */
export function useRepeatActions(today: ISODate, onDone: () => void | Promise<void>) {
  const { attempt, saveError } = useSaveError();
  const offerUndo = useRowUndo(today);

  const run = useCallback(
    async (item: Item, message: string, write: () => Promise<unknown>) => {
      let before: Item | undefined;
      const ok = await attempt(async () => {
        before = await getItem(item.id);
        await write();
      });
      if (!ok) return;
      if (before) offerUndo(message, before);
      await onDone();
    },
    [attempt, offerUndo, onDone],
  );

  return {
    saveError,
    stop: (item: Item) => run(item, `Stopped repeating: ${item.title}`, () => stopRepeating(item.id, today)),
    again: (item: Item) => run(item, `Repeating again: ${item.title}`, () => repeatAgain(item.id, today)),
    remove: (item: Item) => run(item, `Moved to the Bin: ${item.title}`, () => deleteItem(item.id, today)),
  };
}

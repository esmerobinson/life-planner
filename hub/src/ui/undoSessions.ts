import { putItemBack } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { useShellUndo } from "./undoContext";

/**
 * After "Remove session": the shell's Undo line, which puts the whole project row back as it
 * was (putItemBack), so the session returns with its title, details and planned day.
 */
export function useSessionRemovedUndo(today: ISODate) {
  const note = useShellUndo();
  return (was: Item) =>
    note({
      message: "Session removed",
      undo: async () => {
        try {
          await putItemBack(was, today);
          return true;
        } catch {
          return false;
        }
      },
    });
}

/**
 * After a change that can be taken back whole (a book moved to Mind's reading list, a book
 * made a plain idea): the shell's Undo line with `message`, which puts the row back exactly
 * as it was (putItemBack).
 */
export function useRowUndo(today: ISODate) {
  const note = useShellUndo();
  return (message: string, was: Item) =>
    note({
      message,
      undo: async () => {
        try {
          await putItemBack(was, today);
          return true;
        } catch {
          return false;
        }
      },
    });
}

/** The Undo line's words after "Change to → Book" moved something from another area. */
export const MOVED_TO_READING_LIST = "Moved to Mind's reading list";

/** The Undo line's words after "Change to → Book" in Mind (fields it doesn't show are put away). */
export const CHANGED_TO_BOOK = "Changed to a book";

/** The Undo line's words after a book stopped being one. */
export const leftReadingList = (to: "task" | "idea" | "project") =>
  `Changed to ${to === "idea" ? "an idea" : to === "project" ? "a project" : "a to-do"}, off the reading list`;

/**
 * After a project became a to-do or an idea (its sessions dropped): the shell's Undo line,
 * which puts the whole row back exactly as it was (putItemBack, as Inbox and Sort undo).
 */
export function useSessionsUndo(today: ISODate) {
  const note = useShellUndo();
  return (to: "task" | "idea", was: Item) =>
    note({
      message: `Changed to ${to === "idea" ? "an idea" : "a to-do"}, without its sessions`,
      undo: async () => {
        try {
          await putItemBack(was, today);
          return true;
        } catch {
          return false;
        }
      },
    });
}

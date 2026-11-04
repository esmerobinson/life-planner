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

import { createContext, useContext } from "react";

/** A line after an action that can be taken back ("Changed to a to-do, without its sessions · Undo"). */
export interface UndoNote {
  message: string;
  /** Puts things back; the shell re-reads everything afterwards. Resolve false when it did not save. */
  undo: () => Promise<boolean>;
}

/** The shell's setter for its Undo line (null outside the shell). */
export const ShellUndoContext = createContext<((note: UndoNote | null) => void) | null>(null);

/** Shows an Undo line from anywhere in the shell (does nothing outside it). */
export function useShellUndo(): (note: UndoNote | null) => void {
  return useContext(ShellUndoContext) ?? (() => {});
}

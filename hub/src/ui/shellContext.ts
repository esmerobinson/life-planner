import { createContext, useContext } from "react";
import { todayISO } from "../domain/dates";
import type { ISODate } from "../domain/types";

/**
 * Lets pages inside the shell tell it that items changed. `version` bumps after
 * any add/import/file action so every useHubData re-reads; `today` is the shell's
 * current date (kept fresh on focus).
 */
export const ShellContext = createContext<{
  refresh: () => void | Promise<void>;
  version: number;
  today: ISODate;
} | null>(null);

/** The shell's current date; falls back to the clock when rendered outside a shell. */
export function useShellToday(): ISODate {
  return useContext(ShellContext)?.today ?? todayISO();
}

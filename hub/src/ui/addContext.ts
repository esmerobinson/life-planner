import { createContext, useContext, useEffect } from "react";
import type { AreaId } from "../domain/types";

/** What the Add form makes: a to-do, an idea or a goal. */
export type AddType = "task" | "idea" | "goal";

/** Where the Add form opens pre-set (Esme, 2026-11-02: "the default … should be where add has launched from"). */
export interface AddDefaults {
  type: AddType;
  areaId: AreaId;
}

/** Anywhere a page says nothing (and Home, Today): a to-do in the inbox, as Add always did. */
export const BASE_ADD_DEFAULTS: AddDefaults = { type: "task", areaId: "inbox" };

/** The shell's setter for the current page's Add defaults; null outside the shell. */
export const AddDefaultsContext = createContext<((d: AddDefaults | null) => void) | null>(null);

/**
 * A page tells the shell's Add form where it should open pre-set while the page is shown
 * (and while these values hold); leaving the page puts the plain defaults back. A goal is
 * never in the inbox, so `type: "goal"` needs a real area.
 */
export function useAddDefaults(type: AddType, areaId: AreaId | undefined): void {
  const set = useContext(AddDefaultsContext);
  useEffect(() => {
    if (!set || !areaId) return;
    set({ type, areaId });
    return () => set(null);
  }, [set, type, areaId]);
}

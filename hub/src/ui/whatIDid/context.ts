import { createContext, useContext } from "react";
import { isHabit } from "../../domain/habits";
import type { Item } from "../../domain/types";

/**
 * Opens "What did you do?" after a to-do is ticked (Esme, 19 Nov 2026: every to-do tick,
 * skippable; never habits or routine steps). `session`: the project session just ticked. Null
 * outside the app shell (nothing is asked then).
 */
export type DidPrompt = (item: Item, session?: string) => void;

export const WhatIDidContext = createContext<DidPrompt | null>(null);

export function useDidPrompt(): DidPrompt | null {
  return useContext(WhatIDidContext);
}

/** A tick on this asks "What did you do?": a to-do (projects too), never a habit or an idea. */
export function asksWhatIDid(it: Item): boolean {
  return it.kind === "task" && !isHabit(it) && it.areaId !== "inbox";
}

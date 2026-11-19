import { createContext, useContext } from "react";
import { isHabit } from "../../domain/habits";
import type { Item } from "../../domain/types";

/**
 * Opens "What did you do?" after a to-do is ticked (Esme, 19 Nov 2026: every to-do tick,
 * skippable; never habits or routine steps). `session`: the project session just ticked. Null
 * outside the app shell (nothing is asked then).
 */
export type DidPrompt = (item: Item, session?: string, back?: readonly (HTMLElement | null | undefined)[]) => void;

/**
 * Where the focus goes once the card closes (review N2): the ticked box if it is still there (a
 * project's row stays), else the next to-do's tick box, the one before, or the list's heading.
 */
export function focusAfterTick(box: HTMLElement): (HTMLElement | null | undefined)[] {
  const li = box.closest("li");
  const tickIn = (el: Element | null | undefined) => el?.querySelector<HTMLElement>("input.tick, input[type=checkbox]");
  const list = li?.parentElement;
  let heading: HTMLElement | null | undefined;
  for (let el: Element | null | undefined = list; el && !heading; el = el.parentElement) {
    let sib = el.previousElementSibling;
    while (sib && !heading) {
      if (/^H[1-3]$/.test(sib.tagName)) heading = sib as HTMLElement;
      sib = sib.previousElementSibling;
    }
  }
  return [box, tickIn(li?.nextElementSibling), tickIn(li?.previousElementSibling), heading, document.querySelector<HTMLElement>("main h1")];
}

export const WhatIDidContext = createContext<DidPrompt | null>(null);

export function useDidPrompt(): DidPrompt | null {
  return useContext(WhatIDidContext);
}

/** A tick on this asks "What did you do?": a to-do (projects too), never a habit or an idea. */
export function asksWhatIDid(it: Item): boolean {
  return it.kind === "task" && !isHabit(it) && it.areaId !== "inbox";
}

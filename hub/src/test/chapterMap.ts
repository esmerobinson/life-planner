import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Opens "See all chapters" in the exercise tab and every chapter in the current book. */
export async function openAllChapters(tab: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(await within(tab).findByRole("button", { name: "See all chapters" }));
  const map = await screen.findByRole("dialog", { name: "Your workbooks" });
  for (const t of within(map).queryAllByRole("button", { expanded: false })) await userEvent.click(t);
  return map;
}

/** The card buttons in the open chapters and the optional reading, as their text. */
export function cardLines(map: HTMLElement): string[] {
  return [...map.querySelectorAll("button.wb-card-link")].map((b) => b.textContent ?? "");
}

/** Opens one card (by the start of its line, "Day 2 · …") in the chapter map pop-up. */
export async function openCardInMap(tab: HTMLElement, line: string): Promise<HTMLElement> {
  const map = await openAllChapters(tab);
  const button = [...map.querySelectorAll<HTMLButtonElement>("button.wb-card-link")].find((b) => b.textContent?.startsWith(line));
  if (!button) throw new Error(`No card "${line}" in the chapter map: ${cardLines(map).join(" | ")}`);
  await userEvent.click(button);
  return map;
}

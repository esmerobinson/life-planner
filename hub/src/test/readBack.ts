import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Read back's parts, as their tiles and headings name them. */
export type ReadBackPartName = "Mental health exercise" | "Morning pages" | "Daily check-in" | "Notes to myself" | "Highlights";

/** A Read back tile (on the tile view), by its part's name. */
export const findReadBackTile = (name: ReadBackPartName) =>
  screen.findByRole("button", { name: new RegExp(`^${name}`) }, { timeout: 5000 });

/**
 * On Read back's tile view: taps the part's tile and returns that part's whole list (the
 * region named after it, holding its month lists).
 */
export async function openReadBackPart(name: ReadBackPartName): Promise<HTMLElement> {
  await userEvent.click(await findReadBackTile(name));
  return screen.findByRole("region", { name }, { timeout: 5000 });
}

// Testing session (everyday walkthrough, ⌘K search). These tests FAIL on purpose: they show bugs.
//
// What Esme would see: search only matches letters exactly as typed.
// 1. A to-do "Book the Café Nero meeting" is not found when she types "cafe" (no accent):
//    "Nothing matches "cafe"." It is found only with "café".
// 2. A to-do typed on her iPhone, "Ring Mum’s dentist" (the phone keyboard puts in a curly ’),
//    is not found from the Mac when she types "mum's" (a straight '), and the other way round.
// Checked in the real app at 1280 (⌘K) and 390 (🔍): same results at both widths.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildIndex, searchIndex } from "../search/search";
import type { Item } from "../domain/types";
import { SearchDialog } from "./SearchDialog";

const TODAY = "2026-11-04";

function todo(id: string, title: string): Item {
  return { id, kind: "task", title, links: [], areaId: "admin", priority: 2, status: "open", createdAt: TODAY, touchedAt: TODAY };
}

const items = [todo("a", "Book the Café Nero meeting with Priya"), todo("b", "Ring Mum’s dentist")];
const titles = (q: string) => searchIndex(buildIndex(items, [], TODAY), q).flatMap((g) => g.hits.map((h) => h.title));

describe("Testing: search finds what she typed, accents and apostrophes aside", () => {
  it('"cafe" finds "Café"', () => {
    expect(titles("cafe")).toEqual(["Book the Café Nero meeting with Priya"]);
  });

  it(`"mum's" (straight apostrophe, Mac) finds "Mum’s" (curly, typed on the iPhone)`, () => {
    expect(titles("mum's")).toEqual(["Ring Mum’s dentist"]);
  });

  it('in the ⌘K pop-up, typing "cafe" shows the Café to-do, not "Nothing matches"', async () => {
    render(
      <MemoryRouter>
        <SearchDialog items={items} goals={[]} today={TODAY} phone={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "cafe");
    const results = screen.getByRole("listbox", { name: "Results" });
    expect(await within(results).findByText(/Book the/)).toBeInTheDocument();
  });
});

// ⌘K search: an Inbox result shows the Inbox's own tile (Esme, 2026-11-05, option A of
// inbox-tile.html: pale stone with the tray icon), not the magenta placeholder.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Item } from "../domain/types";
import { INBOX_TILE, NAV } from "./areas";
import { SearchDialog } from "./SearchDialog";

const TODAY = "2026-11-05";
const item = (id: string, title: string, areaId: Item["areaId"]): Item => ({
  id, kind: "task", title, links: [], areaId, priority: 2, status: "open", createdAt: TODAY, touchedAt: TODAY,
});

describe("search: the Inbox's tile", () => {
  it("is pale stone with the tray icon; an area keeps its own tile; no magenta", async () => {
    const items = [item("a", "Pretend recipe idea", "inbox"), item("b", "Pretend recipe chapter", "writing")];
    const { container } = render(
      <MemoryRouter>
        <SearchDialog items={items} goals={[]} today={TODAY} phone={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "recipe");
    const results = screen.getByRole("listbox", { name: "Results" });
    const row = async (word: string) =>
      (await within(results).findAllByRole("option")).find((o) => o.textContent!.includes(word))!;
    await within(results).findAllByRole("option");
    const inboxRow = await row("idea");
    const writingRow = await row("chapter");

    const inboxTile = inboxRow.querySelector<HTMLElement>(".sidebar-tile")!;
    expect(inboxTile.style.background).toBe("rgb(212, 209, 195)"); // #d4d1c3
    expect(inboxTile.querySelector("img")!.getAttribute("src")).toBe(INBOX_TILE.icon);
    expect(NAV.map((n) => n.icon)).not.toContain(INBOX_TILE.icon); // its own tray drawing

    const writingTile = writingRow.querySelector<HTMLElement>(".sidebar-tile")!;
    expect(writingTile.querySelector("img")!.getAttribute("src")).toBe(NAV.find((n) => n.id === "writing")!.icon);

    expect(container.querySelector(".search-tile-placeholder")).toBeNull();
  });
});
